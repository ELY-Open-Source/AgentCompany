import { BrowserWindow, session, type NativeImage } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import log from "electron-log/main.js";

/**
 * Browser Automation Manager — Electron-native edition.
 *
 * Uses Electron's own BrowserWindow and persistent sessions instead of
 * external Playwright, so it works in packaged apps with zero extra deps.
 *
 * Each social account gets its own Electron session partition so cookies,
 * localStorage, and login state are isolated and persisted across app restarts.
 */

export interface BrowserAction {
  id: string;
  socialAccountId: string;
  actionType: string;
  payload: Record<string, unknown>;
}

export interface BrowserActionResult {
  success: boolean;
  summary: string;
  screenshotPath: string | null;
  error: string | null;
}

interface QueuedAction {
  action: BrowserAction;
  resolve: (result: BrowserActionResult) => void;
  reject: (error: Error) => void;
}

export class BrowserManager {
  private screenshotDir: string;
  private queues = new Map<string, QueuedAction[]>();
  private processing = new Set<string>();
  /** Track open login windows so we don't open duplicates */
  private loginWindows = new Map<string, BrowserWindow>();

  constructor(profileDir: string) {
    this.screenshotDir = join(profileDir, "browser-screenshots");
    if (!existsSync(this.screenshotDir)) mkdirSync(this.screenshotDir, { recursive: true });
  }

  /**
   * Get a persistent Electron session for a social account.
   * Using `persist:` prefix ensures data survives app restarts.
   */
  private getSession(socialAccountId: string): Electron.Session {
    return session.fromPartition(`persist:social-${socialAccountId}`);
  }

  /**
   * Launch a real browser window for manual login.
   * The window uses a persistent session so cookies are saved.
   * Returns a promise that resolves when the user closes the window.
   */
  async launchLoginBrowser(
    socialAccountId: string,
    platform: string,
    loginUrl?: string,
  ): Promise<BrowserActionResult> {
    // Don't open duplicate login windows for the same account
    const existing = this.loginWindows.get(socialAccountId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return { success: true, summary: "Login window already open", screenshotPath: null, error: null };
    }

    const defaultUrls: Record<string, string> = {
      twitter: "https://x.com/i/flow/login",
      linkedin: "https://www.linkedin.com/login",
      instagram: "https://www.instagram.com/accounts/login/",
      facebook: "https://www.facebook.com/login",
      reddit: "https://www.reddit.com/login",
      youtube: "https://accounts.google.com/signin",
      tiktok: "https://www.tiktok.com/login",
      bluesky: "https://bsky.app",
      other: "https://google.com",
    };

    const url = loginUrl || defaultUrls[platform] || defaultUrls.other;
    const ses = this.getSession(socialAccountId);

    log.info(`[browser] Opening login window for ${platform} → ${url}`);

    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: `Login to ${platform} — AgentCompany`,
      webPreferences: {
        session: ses,
        // Standard web page — no node integration, no preload
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    this.loginWindows.set(socialAccountId, win);

    // Remove menu bar for a cleaner look
    win.setMenuBarVisibility(false);

    // Load the login page
    try {
      await win.loadURL(url);
    } catch (err) {
      log.error(`[browser] Failed to load ${url}: ${err}`);
      // Don't fail — the page might redirect or have an expected error
    }

    // Wait for the user to close the window
    return new Promise<BrowserActionResult>((resolve) => {
      win.on("closed", () => {
        this.loginWindows.delete(socialAccountId);
        log.info(`[browser] Login window closed for ${platform} — session saved`);
        resolve({
          success: true,
          summary: `Login session saved for ${platform}`,
          screenshotPath: null,
          error: null,
        });
      });
    });
  }

  /**
   * Check if browser automation is available.
   * Always true — we use Electron's own Chromium.
   */
  async checkPlaywright(): Promise<boolean> {
    return true;
  }

  /**
   * Queue a browser action for execution.
   */
  async executeAction(action: BrowserAction): Promise<BrowserActionResult> {
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(action.socialAccountId) ?? [];
      queue.push({ action, resolve, reject });
      this.queues.set(action.socialAccountId, queue);
      void this.processQueue(action.socialAccountId);
    });
  }

  private async processQueue(socialAccountId: string) {
    if (this.processing.has(socialAccountId)) return;
    const queue = this.queues.get(socialAccountId);
    if (!queue || queue.length === 0) return;

    this.processing.add(socialAccountId);
    while (queue.length > 0) {
      const item = queue.shift()!;
      try {
        const result = await this.runAction(item.action);
        item.resolve(result);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.processing.delete(socialAccountId);
  }

  /**
   * Execute a single browser action using an Electron BrowserWindow.
   */
  private async runAction(action: BrowserAction): Promise<BrowserActionResult> {
    const ses = this.getSession(action.socialAccountId);
    const payload = action.payload;
    const screenshotPath = join(this.screenshotDir, `${action.id}.png`);

    log.info(`[browser] Executing ${action.actionType} for account ${action.socialAccountId}`);

    // Create a visible browser window for the action
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: `AgentCompany — ${action.actionType}`,
      show: true,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.setMenuBarVisibility(false);

    try {
      let summary = "Action completed";

      switch (action.actionType) {
        case "navigate": {
          const url = String(payload.url || "https://google.com");
          await win.loadURL(url);
          await this.waitForLoad(win);
          const title = await win.webContents.executeJavaScript("document.title");
          summary = `Navigated to ${title}`;
          break;
        }

        case "post": {
          const platform = String(payload.platform || "twitter");
          const content = String(payload.content || "");
          const postUrl = this.getComposeUrl(platform);
          await win.loadURL(postUrl);
          await this.waitForLoad(win);
          await this.delay(2000);

          if (platform === "twitter") {
            // Type into tweet composer
            await win.webContents.executeJavaScript(`
              (async () => {
                const editor = document.querySelector('[data-testid="tweetTextarea_0"], [role="textbox"]');
                if (editor) {
                  editor.focus();
                  document.execCommand('insertText', false, ${JSON.stringify(content)});
                }
              })()
            `);
            await this.delay(1000);
            // Click post button
            await win.webContents.executeJavaScript(`
              (() => {
                const btn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
                if (btn) btn.click();
              })()
            `);
            await this.delay(3000);
          } else if (platform === "linkedin") {
            await win.webContents.executeJavaScript(`
              (() => {
                const btn = document.querySelector('button.share-box-feed-entry__trigger');
                if (btn) btn.click();
              })()
            `);
            await this.delay(2000);
            await win.webContents.executeJavaScript(`
              (async () => {
                const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
                if (editor) {
                  editor.focus();
                  document.execCommand('insertText', false, ${JSON.stringify(content)});
                }
              })()
            `);
            await this.delay(1000);
            await win.webContents.executeJavaScript(`
              (() => {
                const btn = document.querySelector('button.share-actions__primary-action');
                if (btn) btn.click();
              })()
            `);
            await this.delay(3000);
          }
          summary = `Posted to ${platform}: "${content.slice(0, 50)}..."`;
          break;
        }

        case "reply": {
          const targetUrl = String(payload.targetUrl || "");
          const replyContent = String(payload.content || "");
          await win.loadURL(targetUrl);
          await this.waitForLoad(win);
          await this.delay(2000);

          await win.webContents.executeJavaScript(`
            (async () => {
              const editor = document.querySelector('[data-testid="tweetTextarea_0"], [role="textbox"]');
              if (editor) {
                editor.focus();
                document.execCommand('insertText', false, ${JSON.stringify(replyContent)});
              }
            })()
          `);
          await this.delay(1000);
          await win.webContents.executeJavaScript(`
            (() => {
              const btn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"], button[type="submit"]');
              if (btn) btn.click();
            })()
          `);
          await this.delay(3000);
          summary = `Replied to ${targetUrl.slice(0, 50)}`;
          break;
        }

        case "like": {
          const targetUrl = String(payload.targetUrl || "");
          await win.loadURL(targetUrl);
          await this.waitForLoad(win);
          await this.delay(2000);
          await win.webContents.executeJavaScript(`
            (() => {
              const btn = document.querySelector('[data-testid="like"], button[aria-label*="Like"]');
              if (btn) btn.click();
            })()
          `);
          await this.delay(2000);
          summary = `Liked post at ${targetUrl.slice(0, 50)}`;
          break;
        }

        case "follow": {
          const targetUrl = String(payload.targetUrl || payload.profileUrl || "");
          await win.loadURL(targetUrl);
          await this.waitForLoad(win);
          await this.delay(2000);
          await win.webContents.executeJavaScript(`
            (() => {
              const btn = document.querySelector('[data-testid*="follow"], button[aria-label*="Follow"]');
              if (btn && !btn.textContent.includes('Following')) btn.click();
            })()
          `);
          await this.delay(2000);
          summary = `Followed user at ${targetUrl.slice(0, 50)}`;
          break;
        }

        case "browse_feed": {
          const platform = String(payload.platform || "twitter");
          const feedUrl = String(payload.url || this.getFeedUrl(platform));
          const maxPosts = Number(payload.maxPosts || 10);
          await win.loadURL(feedUrl);
          await this.waitForLoad(win);
          await this.delay(3000);

          // Scroll to load content
          for (let i = 0; i < 3; i++) {
            await win.webContents.executeJavaScript("window.scrollBy(0, window.innerHeight)");
            await this.delay(1500);
          }

          const posts: string[] = await win.webContents.executeJavaScript(`
            (() => {
              const articles = document.querySelectorAll('article, [data-testid="tweet"], .feed-shared-update-v2');
              return Array.from(articles).slice(0, ${maxPosts}).map(el => el.innerText.slice(0, 300));
            })()
          `);
          summary = `Browsed feed — found ${posts.length} posts`;
          break;
        }

        case "search": {
          const query = String(payload.query || "");
          const platform = String(payload.platform || "twitter");
          const searchUrl = this.getSearchUrl(platform, query);
          await win.loadURL(searchUrl);
          await this.waitForLoad(win);
          await this.delay(3000);

          const results: string[] = await win.webContents.executeJavaScript(`
            (() => {
              const items = document.querySelectorAll('article, [data-testid="tweet"], .search-result');
              return Array.from(items).slice(0, 10).map(el => el.innerText.slice(0, 200));
            })()
          `);
          summary = `Search "${query.slice(0, 30)}" — ${results.length} results`;
          break;
        }

        case "screenshot": {
          const url = String(payload.url || "about:blank");
          if (url !== "about:blank") {
            await win.loadURL(url);
            await this.waitForLoad(win);
            await this.delay(2000);
          }
          const title = await win.webContents.executeJavaScript("document.title");
          summary = `Screenshot captured: ${title}`;
          break;
        }

        default:
          summary = `Unknown action type: ${action.actionType}`;
      }

      // Capture screenshot
      try {
        const image: NativeImage = await win.webContents.capturePage();
        if (!image.isEmpty()) {
          writeFileSync(screenshotPath, image.toPNG());
        }
      } catch (err) {
        log.warn(`[browser] Screenshot failed: ${err}`);
      }

      // Close the action window after a brief pause so user can see result
      await this.delay(1000);
      if (!win.isDestroyed()) win.close();

      return {
        success: true,
        summary,
        screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
        error: null,
      };
    } catch (error) {
      // Try to capture error screenshot
      try {
        const image: NativeImage = await win.webContents.capturePage();
        if (!image.isEmpty()) writeFileSync(screenshotPath, image.toPNG());
      } catch { /* ignore */ }

      if (!win.isDestroyed()) win.close();

      const msg = error instanceof Error ? error.message : String(error);
      log.error(`[browser] Action ${action.actionType} failed: ${msg}`);
      return {
        success: false,
        summary: "Action failed",
        screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
        error: msg,
      };
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private waitForLoad(win: BrowserWindow, timeoutMs = 15000): Promise<void> {
    return new Promise((resolve) => {
      if (win.webContents.isLoading()) {
        const timer = setTimeout(resolve, timeoutMs);
        win.webContents.once("did-finish-load", () => {
          clearTimeout(timer);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private getComposeUrl(platform: string): string {
    const urls: Record<string, string> = {
      twitter: "https://x.com/compose/post",
      linkedin: "https://www.linkedin.com/feed/",
      instagram: "https://www.instagram.com/",
      facebook: "https://www.facebook.com/",
      reddit: "https://www.reddit.com/submit",
      bluesky: "https://bsky.app/",
    };
    return urls[platform] || "https://google.com";
  }

  private getFeedUrl(platform: string): string {
    const urls: Record<string, string> = {
      twitter: "https://x.com/home",
      linkedin: "https://www.linkedin.com/feed/",
      instagram: "https://www.instagram.com/",
      reddit: "https://www.reddit.com/",
      bluesky: "https://bsky.app/",
    };
    return urls[platform] || "https://google.com";
  }

  private getSearchUrl(platform: string, query: string): string {
    const q = encodeURIComponent(query);
    const urls: Record<string, string> = {
      twitter: `https://x.com/search?q=${q}`,
      linkedin: `https://www.linkedin.com/search/results/all/?keywords=${q}`,
      reddit: `https://www.reddit.com/search/?q=${q}`,
    };
    return urls[platform] || `https://google.com/search?q=${q}`;
  }

  shutdown() {
    // Close any open login windows
    for (const [, win] of this.loginWindows) {
      if (!win.isDestroyed()) win.close();
    }
    this.loginWindows.clear();
    this.queues.clear();
    this.processing.clear();
  }
}
