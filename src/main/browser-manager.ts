import { BrowserWindow, session, type NativeImage } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import log from "electron-log/main.js";

export interface BrowserAction {
  id: string;
  socialAccountId: string;
  platform: string;
  actionType: string;
  payload: Record<string, unknown>;
}

export interface BrowserActionResult {
  success: boolean;
  cancelled: boolean;
  summary: string;
  screenshotPath: string | null;
  error: string | null;
}

interface QueuedAction {
  action: BrowserAction;
  resolve: (result: BrowserActionResult) => void;
  reject: (error: Error) => void;
}

interface PlatformRule {
  loginUrl: string;
  authCheckUrl: string;
  allowedHosts: string[];
  cookieOrigins: string[];
  unauthenticatedUrlMarkers: string[];
}

const PLATFORM_RULES: Record<string, PlatformRule> = {
  twitter: {
    loginUrl: "https://x.com/i/flow/login",
    authCheckUrl: "https://x.com/home",
    allowedHosts: ["x.com", "twitter.com"],
    cookieOrigins: ["https://x.com", "https://twitter.com"],
    unauthenticatedUrlMarkers: ["/i/flow/login", "/login"],
  },
  linkedin: {
    loginUrl: "https://www.linkedin.com/login",
    authCheckUrl: "https://www.linkedin.com/feed/",
    allowedHosts: ["linkedin.com"],
    cookieOrigins: ["https://www.linkedin.com"],
    unauthenticatedUrlMarkers: ["/login", "/checkpoint"],
  },
  instagram: {
    loginUrl: "https://www.instagram.com/accounts/login/",
    authCheckUrl: "https://www.instagram.com/",
    allowedHosts: ["instagram.com"],
    cookieOrigins: ["https://www.instagram.com"],
    unauthenticatedUrlMarkers: ["/accounts/login"],
  },
  facebook: {
    loginUrl: "https://www.facebook.com/login",
    authCheckUrl: "https://www.facebook.com/",
    allowedHosts: ["facebook.com"],
    cookieOrigins: ["https://www.facebook.com"],
    unauthenticatedUrlMarkers: ["/login"],
  },
  reddit: {
    loginUrl: "https://www.reddit.com/login",
    authCheckUrl: "https://www.reddit.com/",
    allowedHosts: ["reddit.com"],
    cookieOrigins: ["https://www.reddit.com"],
    unauthenticatedUrlMarkers: ["/login"],
  },
  youtube: {
    loginUrl: "https://accounts.google.com/signin",
    authCheckUrl: "https://www.youtube.com/",
    allowedHosts: ["youtube.com", "google.com"],
    cookieOrigins: ["https://www.youtube.com", "https://accounts.google.com"],
    unauthenticatedUrlMarkers: ["/signin", "/ServiceLogin"],
  },
  tiktok: {
    loginUrl: "https://www.tiktok.com/login",
    authCheckUrl: "https://www.tiktok.com/foryou",
    allowedHosts: ["tiktok.com"],
    cookieOrigins: ["https://www.tiktok.com"],
    unauthenticatedUrlMarkers: ["/login"],
  },
  bluesky: {
    loginUrl: "https://bsky.app",
    authCheckUrl: "https://bsky.app/",
    allowedHosts: ["bsky.app"],
    cookieOrigins: ["https://bsky.app"],
    unauthenticatedUrlMarkers: ["/login"],
  },
  other: {
    loginUrl: "https://google.com",
    authCheckUrl: "https://google.com",
    allowedHosts: ["google.com"],
    cookieOrigins: ["https://google.com"],
    unauthenticatedUrlMarkers: ["/login"],
  },
};

export class BrowserManager {
  private screenshotDir: string;
  private queues = new Map<string, QueuedAction[]>();
  private processing = new Set<string>();
  private loginWindows = new Map<string, BrowserWindow>();
  private initializedSessions = new Set<string>();
  private activeActionWindows = new Map<string, BrowserWindow>();
  private cancelledActionIds = new Set<string>();

  constructor(profileDir: string) {
    this.screenshotDir = join(profileDir, "browser-screenshots");
    if (!existsSync(this.screenshotDir)) mkdirSync(this.screenshotDir, { recursive: true });
  }

  private getSession(socialAccountId: string): Electron.Session {
    const partition = `persist:social-${socialAccountId}`;
    const socialSession = session.fromPartition(partition);
    if (!this.initializedSessions.has(partition)) {
      socialSession.setPermissionCheckHandler(() => false);
      socialSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      this.initializedSessions.add(partition);
    }
    return socialSession;
  }

  async clearSocialAccountData(socialAccountId: string, screenshotPaths: string[] = []) {
    const existing = this.loginWindows.get(socialAccountId);
    if (existing && !existing.isDestroyed()) {
      existing.close();
    }
    this.loginWindows.delete(socialAccountId);
    this.queues.delete(socialAccountId);
    this.processing.delete(socialAccountId);

    const ses = this.getSession(socialAccountId);
    try {
      await ses.clearStorageData();
      await ses.clearCache();
      await ses.clearAuthCache();
    } catch (error) {
      log.warn(`[browser] Failed to fully clear session for ${socialAccountId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    await Promise.all(
      screenshotPaths
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        .filter((screenshotPath) => {
          const resolvedPath = resolve(screenshotPath);
          const resolvedRoot = resolve(this.screenshotDir);
          return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`);
        })
        .map((screenshotPath) => rm(screenshotPath, { force: true }).catch(() => undefined)),
    );
  }

  async launchLoginBrowser(
    socialAccountId: string,
    platform: string,
    loginUrl?: string,
  ): Promise<BrowserActionResult> {
    const existing = this.loginWindows.get(socialAccountId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return { success: true, cancelled: false, summary: "Login window already open", screenshotPath: null, error: null };
    }

    const rules = this.getPlatformRules(platform);
    const url = loginUrl || rules.loginUrl;
    const ses = this.getSession(socialAccountId);
    this.assertAllowedUrl(platform, url, "login");

    log.info(`[browser] Opening login window for ${platform} → ${url}`);

    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: `Login to ${platform} — AgentCompany`,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    this.loginWindows.set(socialAccountId, win);
    this.attachWindowSecurity(win, platform);

    win.setMenuBarVisibility(false);

    try {
      await win.loadURL(url);
    } catch (err) {
      log.error(`[browser] Failed to load ${url}: ${err}`);
    }

    return new Promise<BrowserActionResult>((resolve) => {
      win.on("closed", () => {
        this.loginWindows.delete(socialAccountId);
        void this.verifyLoginSession(socialAccountId, platform).then((verified) => {
          log.info(`[browser] Login window closed for ${platform} — verified=${verified}`);
          resolve({
            success: verified,
            cancelled: false,
            summary: verified
              ? `Authenticated session detected for ${platform}`
              : `No authenticated ${platform} session detected`,
            screenshotPath: null,
            error: verified ? null : `Authentication for ${platform} was not completed.`,
          });
        });
      });
    });
  }

  async executeAction(action: BrowserAction): Promise<BrowserActionResult> {
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(action.socialAccountId) ?? [];
      queue.push({ action, resolve, reject });
      this.queues.set(action.socialAccountId, queue);
      void this.processQueue(action.socialAccountId);
    });
  }

  cancelAction(actionId: string): boolean {
    this.cancelledActionIds.add(actionId);
    const activeWindow = this.activeActionWindows.get(actionId);
    if (activeWindow && !activeWindow.isDestroyed()) {
      activeWindow.close();
      return true;
    }

    for (const [socialAccountId, queue] of this.queues.entries()) {
      const index = queue.findIndex((item) => item.action.id === actionId);
      if (index < 0) {
        continue;
      }
      const [item] = queue.splice(index, 1);
      item?.resolve({
        success: false,
        cancelled: true,
        summary: "Action cancelled before execution.",
        screenshotPath: null,
        error: "Action cancelled.",
      });
      if (queue.length === 0) {
        this.queues.delete(socialAccountId);
      }
      return true;
    }

    return false;
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

  private async runAction(action: BrowserAction): Promise<BrowserActionResult> {
    const ses = this.getSession(action.socialAccountId);
    const payload = action.payload;
    const screenshotPath = join(this.screenshotDir, `${action.id}.png`);
    const platform = action.platform;

    log.info(`[browser] Executing ${action.actionType} for ${platform}/${action.socialAccountId}`);

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
    this.activeActionWindows.set(action.id, win);
    this.attachWindowSecurity(win, platform);
    win.setMenuBarVisibility(false);

    try {
      let summary = "Action completed";
      const assertNotCancelled = () => {
        if (this.cancelledActionIds.has(action.id)) {
          throw new Error("BROWSER_ACTION_CANCELLED");
        }
      };

      switch (action.actionType) {
        case "navigate": {
          assertNotCancelled();
          const url = String(payload.url || "https://google.com");
          this.assertAllowedUrl(platform, url, "navigate");
          await win.loadURL(url);
          await this.waitForLoad(win);
          assertNotCancelled();
          const title = await win.webContents.executeJavaScript("document.title");
          summary = `Navigated to ${title}`;
          break;
        }

        case "post": {
          assertNotCancelled();
          const content = String(payload.content || "");
          const postUrl = this.getComposeUrl(platform);
          await win.loadURL(postUrl);
          await this.waitForLoad(win);
          await this.delay(2000);
          assertNotCancelled();

          if (platform === "twitter") {
            // Use clipboard-based approach since Twitter's React editor ignores execCommand
            await win.webContents.executeJavaScript(`
              (async () => {
                const editor = document.querySelector('[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]');
                if (!editor) return;
                editor.focus();
                // Write content to clipboard and paste it — this triggers React's input handlers
                const dt = new DataTransfer();
                dt.setData('text/plain', ${JSON.stringify(content)});
                const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                editor.dispatchEvent(pasteEvent);
                // Fallback: if paste didn't work, set innerHTML and dispatch input
                await new Promise(r => setTimeout(r, 500));
                if (!editor.textContent || editor.textContent.trim().length === 0) {
                  editor.textContent = ${JSON.stringify(content)};
                  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(content)} }));
                }
              })()
            `);
            await this.delay(1500);
            await win.webContents.executeJavaScript(`
              (() => {
                const btn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
                if (btn && !btn.disabled) btn.click();
              })()
            `);
            await this.delay(3000);
          } else if (platform === "linkedin") {
            await win.webContents.executeJavaScript(`
              (() => {
                const btn = document.querySelector('button.share-box-feed-entry__trigger, button.artdeco-button--muted');
                if (btn) btn.click();
              })()
            `);
            await this.delay(2000);
            await win.webContents.executeJavaScript(`
              (async () => {
                const editor = document.querySelector('[role="textbox"][contenteditable="true"], .ql-editor[contenteditable="true"]');
                if (editor) {
                  editor.focus();
                  const dt = new DataTransfer();
                  dt.setData('text/plain', ${JSON.stringify(content)});
                  const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                  editor.dispatchEvent(pasteEvent);
                  await new Promise(r => setTimeout(r, 500));
                  if (!editor.textContent || editor.textContent.trim().length === 0) {
                    editor.textContent = ${JSON.stringify(content)};
                    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
                  }
                }
              })()
            `);
            await this.delay(1500);
            await win.webContents.executeJavaScript(`
              (() => {
                const btn = document.querySelector('button.share-actions__primary-action, button.artdeco-button--primary[type="submit"]');
                if (btn && !btn.disabled) btn.click();
              })()
            `);
            await this.delay(3000);
          }
          summary = `Posted to ${platform}: "${content.slice(0, 50)}..."`;
          break;
        }

        case "reply": {
          assertNotCancelled();
          const targetUrl = String(payload.targetUrl || "");
          this.assertAllowedUrl(platform, targetUrl, "reply");
          const replyContent = String(payload.content || "");
          await win.loadURL(targetUrl);
          await this.waitForLoad(win);
          await this.delay(2000);
          assertNotCancelled();

          await win.webContents.executeJavaScript(`
            (async () => {
              const editor = document.querySelector('[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]');
              if (editor) {
                editor.focus();
                const dt = new DataTransfer();
                dt.setData('text/plain', ${JSON.stringify(replyContent)});
                const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                editor.dispatchEvent(pasteEvent);
                await new Promise(r => setTimeout(r, 500));
                if (!editor.textContent || editor.textContent.trim().length === 0) {
                  editor.textContent = ${JSON.stringify(replyContent)};
                  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(replyContent)} }));
                }
              }
            })()
          `);
          await this.delay(1500);
          await win.webContents.executeJavaScript(`
            (() => {
              const btn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"], button[type="submit"]');
              if (btn && !btn.disabled) btn.click();
            })()
          `);
          await this.delay(3000);
          summary = `Replied to ${targetUrl.slice(0, 50)}`;
          break;
        }

        case "like": {
          assertNotCancelled();
          const targetUrl = String(payload.targetUrl || "");
          this.assertAllowedUrl(platform, targetUrl, "like");
          await win.loadURL(targetUrl);
          await this.waitForLoad(win);
          await this.delay(2000);
          assertNotCancelled();
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
          assertNotCancelled();
          const targetUrl = String(payload.targetUrl || payload.profileUrl || "");
          this.assertAllowedUrl(platform, targetUrl, "follow");
          await win.loadURL(targetUrl);
          await this.waitForLoad(win);
          await this.delay(2000);
          assertNotCancelled();
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
          assertNotCancelled();
          const feedUrl = String(payload.url || this.getFeedUrl(platform));
          this.assertAllowedUrl(platform, feedUrl, "browse_feed");
          const maxPosts = Number(payload.maxPosts || 10);
          await win.loadURL(feedUrl);
          await this.waitForLoad(win);
          await this.delay(3000);
          assertNotCancelled();

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
          assertNotCancelled();
          const query = String(payload.query || "");
          const searchUrl = this.getSearchUrl(platform, query);
          this.assertAllowedUrl(platform, searchUrl, "search");
          await win.loadURL(searchUrl);
          await this.waitForLoad(win);
          await this.delay(3000);
          assertNotCancelled();

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
          assertNotCancelled();
          const url = String(payload.url || "about:blank");
          if (url !== "about:blank") {
            this.assertAllowedUrl(platform, url, "screenshot");
            await win.loadURL(url);
            await this.waitForLoad(win);
            await this.delay(2000);
          }
          assertNotCancelled();
          const title = await win.webContents.executeJavaScript("document.title");
          summary = `Screenshot captured: ${title}`;
          break;
        }

        default:
          throw new Error(`Unsupported browser action type: ${action.actionType}`);
      }

      try {
        const image: NativeImage = await win.webContents.capturePage();
        if (!image.isEmpty()) {
          writeFileSync(screenshotPath, image.toPNG());
        }
      } catch (err) {
        log.warn(`[browser] Screenshot failed: ${err}`);
      }

      await this.delay(1000);
      if (!win.isDestroyed()) win.close();

      return {
        success: true,
        cancelled: false,
        summary,
        screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
        error: null,
      };
    } catch (error) {
      const wasCancelled = this.cancelledActionIds.has(action.id) || (error instanceof Error && error.message === "BROWSER_ACTION_CANCELLED");
      try {
        const image: NativeImage = await win.webContents.capturePage();
        if (!image.isEmpty()) writeFileSync(screenshotPath, image.toPNG());
      } catch { /* ignore */ }

      if (!win.isDestroyed()) win.close();

      const msg = wasCancelled ? "Action cancelled." : error instanceof Error ? error.message : String(error);
      if (!wasCancelled) {
        log.error(`[browser] Action ${action.actionType} failed: ${msg}`);
      }
      return {
        success: false,
        cancelled: wasCancelled,
        summary: wasCancelled ? "Action cancelled" : "Action failed",
        screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
        error: msg,
      };
    } finally {
      this.activeActionWindows.delete(action.id);
      this.cancelledActionIds.delete(action.id);
    }
  }

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

  private getPlatformRules(platform: string): PlatformRule {
    return PLATFORM_RULES[platform] ?? PLATFORM_RULES.other;
  }

  private isAllowedNavigation(platform: string, rawUrl: string) {
    try {
      this.assertAllowedUrl(platform, rawUrl, "navigate");
      return true;
    } catch {
      return false;
    }
  }

  private attachWindowSecurity(win: BrowserWindow, platform: string) {
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (!this.isAllowedNavigation(platform, url)) {
        return { action: "deny" };
      }
      setImmediate(() => {
        void win.loadURL(url).catch((error) => {
          log.warn(`[browser] Failed to open allowed popup target for ${platform}: ${error instanceof Error ? error.message : String(error)}`);
        });
      });
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, navigationUrl) => {
      if (this.isAllowedNavigation(platform, navigationUrl)) {
        return;
      }
      event.preventDefault();
      log.warn(`[browser] Blocked navigation outside allowlist for ${platform}: ${navigationUrl}`);
    });
    win.webContents.on("will-redirect", (event, navigationUrl) => {
      if (this.isAllowedNavigation(platform, navigationUrl)) {
        return;
      }
      event.preventDefault();
      log.warn(`[browser] Blocked redirect outside allowlist for ${platform}: ${navigationUrl}`);
    });
  }

  private assertAllowedUrl(platform: string, rawUrl: string, actionType: string) {
    const allowedHosts = this.getPlatformRules(platform).allowedHosts;
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid URL for ${actionType}: ${rawUrl}`);
    }
    if (url.protocol !== "https:") {
      throw new Error(`Navigation blocked for ${actionType}. Only https URLs are allowed.`);
    }
    const host = url.hostname.toLowerCase();
    const isAllowed = allowedHosts.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`));
    if (!isAllowed) {
      throw new Error(`Navigation blocked for ${actionType}. ${host} is outside the allowed ${platform} domains.`);
    }
  }

  private async verifyLoginSession(socialAccountId: string, platform: string): Promise<boolean> {
    const ses = this.getSession(socialAccountId);
    const rules = this.getPlatformRules(platform);
    const cookieSets = await Promise.all(
      rules.cookieOrigins.map(async (origin) => {
        try {
          return await ses.cookies.get({ url: origin });
        } catch {
          return [];
        }
      }),
    );
    const hasCookies = cookieSets.some((cookies) => cookies.length > 0);
    if (!hasCookies) {
      return false;
    }

    const verificationWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    try {
      await verificationWindow.loadURL(rules.authCheckUrl);
      await this.waitForLoad(verificationWindow, 10000);
      const finalUrl = verificationWindow.webContents.getURL();
      const finalUrlLower = finalUrl.toLowerCase();
      const bouncedToLogin = rules.unauthenticatedUrlMarkers.some((marker) => finalUrlLower.includes(marker.toLowerCase()));
      return !bouncedToLogin;
    } catch (error) {
      log.warn(`[browser] Login verification failed for ${platform}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      if (!verificationWindow.isDestroyed()) {
        verificationWindow.close();
      }
    }
  }

  private getComposeUrl(platform: string): string {
    const urls: Record<string, string> = {
      twitter: "https://x.com/compose/tweet",
      linkedin: "https://www.linkedin.com/feed/",
      instagram: "https://www.instagram.com/",
      facebook: "https://www.facebook.com/",
      reddit: "https://www.reddit.com/submit",
      bluesky: "https://bsky.app/",
      youtube: "https://www.youtube.com/",
      tiktok: "https://www.tiktok.com/",
    };
    return urls[platform] || this.getPlatformRules(platform).loginUrl;
  }

  private getFeedUrl(platform: string): string {
    const urls: Record<string, string> = {
      twitter: "https://x.com/home",
      linkedin: "https://www.linkedin.com/feed/",
      instagram: "https://www.instagram.com/",
      facebook: "https://www.facebook.com/",
      reddit: "https://www.reddit.com/",
      bluesky: "https://bsky.app/",
      youtube: "https://www.youtube.com/",
      tiktok: "https://www.tiktok.com/",
    };
    return urls[platform] || this.getPlatformRules(platform).loginUrl;
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
    for (const [, win] of this.loginWindows) {
      if (!win.isDestroyed()) win.close();
    }
    this.loginWindows.clear();
    this.activeActionWindows.clear();
    this.cancelledActionIds.clear();
    this.queues.clear();
    this.processing.clear();
  }
}
