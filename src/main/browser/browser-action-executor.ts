import { BrowserWindow } from "electron";
import { existsSync, writeFileSync } from "node:fs";
import type { NativeImage } from "electron";
import log from "electron-log/main.js";
import type { BrowserAction, BrowserActionResult } from "./browser-types";
import { assertAllowedUrl, attachWindowSecurity, getComposeUrl, getFeedUrl, getSearchUrl } from "./browser-url-helpers";

export { getPlatformRules, assertAllowedUrl, attachWindowSecurity } from "./browser-url-helpers";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitForLoad(win: BrowserWindow, timeoutMs = 15000): Promise<void> {
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

export async function runAction(
  action: BrowserAction,
  screenshotDir: string,
  session: Electron.Session,
  cancelledActionIds: Set<string>,
  activeActionWindows: Map<string, BrowserWindow>,
): Promise<BrowserActionResult> {
  const payload = action.payload;
  const screenshotPath = `${screenshotDir}/${action.id}.png`;
  const platform = action.platform;

  log.info(`[browser] Executing ${action.actionType} for ${platform}/${action.socialAccountId}`);

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: `AgentCompany — ${action.actionType}`,
    show: true,
    webPreferences: {
      session,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  activeActionWindows.set(action.id, win);
  attachWindowSecurity(win, platform);
  win.setMenuBarVisibility(false);

  try {
    let summary = "Action completed";
    const assertNotCancelled = () => {
      if (cancelledActionIds.has(action.id)) {
        throw new Error("BROWSER_ACTION_CANCELLED");
      }
    };

    switch (action.actionType) {
      case "navigate": {
        assertNotCancelled();
        const url = String(payload.url || "https://google.com");
        assertAllowedUrl(platform, url, "navigate");
        await win.loadURL(url);
        await waitForLoad(win);
        assertNotCancelled();
        const title = await win.webContents.executeJavaScript("document.title");
        summary = `Navigated to ${title}`;
        break;
      }

      case "post": {
        assertNotCancelled();
        const content = String(payload.content || "");
        const postUrl = getComposeUrl(platform);
        await win.loadURL(postUrl);
        await waitForLoad(win);
        await delay(2000);
        assertNotCancelled();

        if (platform === "twitter") {
          // Use clipboard-based approach since Twitter's React editor ignores execCommand
          await win.webContents.executeJavaScript(`
            (async () => {
              const editor = document.querySelector('[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]');
              if (!editor) return;
              editor.focus();
              const dt = new DataTransfer();
              dt.setData('text/plain', ${JSON.stringify(content)});
              const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
              editor.dispatchEvent(pasteEvent);
              await new Promise(r => setTimeout(r, 500));
              if (!editor.textContent || editor.textContent.trim().length === 0) {
                editor.textContent = ${JSON.stringify(content)};
                editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(content)} }));
              }
            })()
          `);
          await delay(1500);
          await win.webContents.executeJavaScript(`
            (() => {
              const btn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
              if (btn && !btn.disabled) btn.click();
            })()
          `);
          await delay(3000);
        } else if (platform === "linkedin") {
          await win.webContents.executeJavaScript(`
            (() => {
              const btn = document.querySelector('button.share-box-feed-entry__trigger, button.artdeco-button--muted');
              if (btn) btn.click();
            })()
          `);
          await delay(2000);
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
          await delay(1500);
          await win.webContents.executeJavaScript(`
            (() => {
              const btn = document.querySelector('button.share-actions__primary-action, button.artdeco-button--primary[type="submit"]');
              if (btn && !btn.disabled) btn.click();
            })()
          `);
          await delay(3000);
        }
        summary = `Posted to ${platform}: "${content.slice(0, 50)}..."`;
        break;
      }

      case "reply": {
        assertNotCancelled();
        const targetUrl = String(payload.targetUrl || "");
        assertAllowedUrl(platform, targetUrl, "reply");
        const replyContent = String(payload.content || "");
        await win.loadURL(targetUrl);
        await waitForLoad(win);
        await delay(2000);
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
        await delay(1500);
        await win.webContents.executeJavaScript(`
          (() => {
            const btn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"], button[type="submit"]');
            if (btn && !btn.disabled) btn.click();
          })()
        `);
        await delay(3000);
        summary = `Replied to ${targetUrl.slice(0, 50)}`;
        break;
      }

      case "like": {
        assertNotCancelled();
        const targetUrl = String(payload.targetUrl || "");
        assertAllowedUrl(platform, targetUrl, "like");
        await win.loadURL(targetUrl);
        await waitForLoad(win);
        await delay(2000);
        assertNotCancelled();
        await win.webContents.executeJavaScript(`
          (() => {
            const btn = document.querySelector('[data-testid="like"], button[aria-label*="Like"]');
            if (btn) btn.click();
          })()
        `);
        await delay(2000);
        summary = `Liked post at ${targetUrl.slice(0, 50)}`;
        break;
      }

      case "follow": {
        assertNotCancelled();
        const targetUrl = String(payload.targetUrl || payload.profileUrl || "");
        assertAllowedUrl(platform, targetUrl, "follow");
        await win.loadURL(targetUrl);
        await waitForLoad(win);
        await delay(2000);
        assertNotCancelled();
        await win.webContents.executeJavaScript(`
          (() => {
            const btn = document.querySelector('[data-testid*="follow"], button[aria-label*="Follow"]');
            if (btn && !btn.textContent.includes('Following')) btn.click();
          })()
        `);
        await delay(2000);
        summary = `Followed user at ${targetUrl.slice(0, 50)}`;
        break;
      }

      case "browse_feed": {
        assertNotCancelled();
        const feedUrl = String(payload.url || getFeedUrl(platform));
        assertAllowedUrl(platform, feedUrl, "browse_feed");
        const maxPosts = Number(payload.maxPosts || 10);
        await win.loadURL(feedUrl);
        await waitForLoad(win);
        await delay(3000);
        assertNotCancelled();

        for (let i = 0; i < 3; i++) {
          await win.webContents.executeJavaScript("window.scrollBy(0, window.innerHeight)");
          await delay(1500);
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
        const searchUrl = getSearchUrl(platform, query);
        assertAllowedUrl(platform, searchUrl, "search");
        await win.loadURL(searchUrl);
        await waitForLoad(win);
        await delay(3000);
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
          assertAllowedUrl(platform, url, "screenshot");
          await win.loadURL(url);
          await waitForLoad(win);
          await delay(2000);
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

    await delay(1000);
    if (!win.isDestroyed()) win.close();

    return {
      success: true,
      cancelled: false,
      summary,
      screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
      error: null,
    };
  } catch (error) {
    const wasCancelled = cancelledActionIds.has(action.id) || (error instanceof Error && error.message === "BROWSER_ACTION_CANCELLED");
    try {
      const image: NativeImage = await win.webContents.capturePage();
      if (!image.isEmpty()) writeFileSync(screenshotPath, image.toPNG());
    } catch (screenshotError) {
      log.warn(
        `[browser] failure screenshot capture failed for action ${action.id}: ${screenshotError instanceof Error ? screenshotError.message : String(screenshotError)}`,
      );
    }

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
    activeActionWindows.delete(action.id);
    cancelledActionIds.delete(action.id);
  }
}
