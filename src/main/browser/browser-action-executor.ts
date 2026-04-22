import { BrowserWindow } from "electron";
import { existsSync, writeFileSync } from "node:fs";
import type { NativeImage } from "electron";
import log from "electron-log/main.js";
import type { BrowserAction, BrowserActionResult } from "./browser-types";
import {
  assertAllowedUrl,
  attachWindowSecurity,
  getComposeUrl,
  getFeedUrl,
  getPlatformRules,
  getSearchUrl,
} from "./browser-url-helpers";
import { BrowserCdpClient } from "./browser-action-cdp";
import { assertAuthenticatedPage, assertAuthenticatedSession } from "./browser-action-auth";
import { getPlatformSelectors } from "./platform-selectors";
import type { PlatformSelectors } from "./platform-selectors";
import { browserVerificationFailed } from "./browser-action-errors";
import { isAppError } from "../errors/index.js";

export { getPlatformRules, assertAllowedUrl, attachWindowSecurity } from "./browser-url-helpers";

type BrowserActionOutcome =
  | "success"
  | "logged_out"
  | "selector_drift"
  | "network"
  | "rate_limited"
  | "cancelled"
  | "verification_failed";

interface BrowserActionTelemetry {
  platform: string;
  action_type: string;
  selector_hit: string | null;
  selector_hits: string[];
  retries: number;
  duration_ms: number;
  final_outcome: BrowserActionOutcome;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitForLoad(
  win: BrowserWindow,
  timeoutMs = 15000,
  context: { platform: string; actionType: string } = { platform: "browser", actionType: "load" },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!win.webContents.isLoading()) {
      resolve();
      return;
    }

    const cleanup = () => {
      clearTimeout(timer);
      win.webContents.off("did-finish-load", onFinish);
      win.webContents.off("did-fail-load", onFail);
      win.off("closed", onClosed);
    };
    const fail = (expectation: string) => {
      cleanup();
      reject(browserVerificationFailed(context.platform, context.actionType, expectation));
    };
    const onFinish = () => {
      cleanup();
      resolve();
    };
    const onFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame) fail(`page load failed: ${errorDescription} (${errorCode})`);
    };
    const onClosed = () => fail("window closed during page load");
    const timer = setTimeout(() => fail(`page load exceeded ${timeoutMs}ms`), timeoutMs);

    win.webContents.once("did-finish-load", onFinish);
    win.webContents.on("did-fail-load", onFail);
    win.once("closed", onClosed);
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
  const startedAt = Date.now();
  const selectorHits: string[] = [];

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

  const cdp = new BrowserCdpClient(win.webContents, platform, action.actionType);
  const selectors = getPlatformSelectors(platform);
  const assertNotCancelled = () => {
    if (cancelledActionIds.has(action.id)) {
      throw new Error("BROWSER_ACTION_CANCELLED");
    }
  };
  const remember = (selector: string | null) => {
    if (selector) selectorHits.push(selector);
  };

  try {
    assertNotCancelled();
    await assertAuthenticatedSession(session, platform, action.actionType);
    let summary = "Action completed";

    switch (action.actionType) {
      case "navigate": {
        const url = String(payload.url || getFeedUrl(platform));
        await loadActionUrl(win, platform, action.actionType, url);
        remember(await confirmAuthenticatedPage(win, cdp, selectors, platform, action.actionType));
        const title = await cdp.evaluate<string>("document.title");
        summary = `Navigated to ${title}`;
        break;
      }

      case "post": {
        const content = requirePayloadText(payload.content, "content");
        await loadActionUrl(win, platform, action.actionType, getComposeUrl(platform));
        remember(await confirmAuthenticatedPage(win, cdp, selectors, platform, action.actionType));
        remember(await cdp.clickOptional(selectors.composerOpen, "composer_open"));
        remember(await cdp.focusAndType(selectors.editor, content, "editor"));
        assertNotCancelled();
        remember(await cdp.clickFirst(selectors.submit, "submit"));
        await cdp.waitForText(selectors.feedItems, content);
        summary = `Posted to ${platform}: "${content.slice(0, 50)}..."`;
        break;
      }

      case "reply": {
        const targetUrl = requirePayloadText(payload.targetUrl, "targetUrl");
        const replyContent = requirePayloadText(payload.content, "content");
        await loadActionUrl(win, platform, action.actionType, targetUrl);
        remember(await confirmAuthenticatedPage(win, cdp, selectors, platform, action.actionType));
        remember(await cdp.focusAndType(selectors.replyEditor, replyContent, "reply_editor"));
        assertNotCancelled();
        remember(await cdp.clickFirst(selectors.replySubmit, "reply_submit"));
        await cdp.waitForText(selectors.feedItems, replyContent);
        summary = `Replied to ${targetUrl.slice(0, 50)}`;
        break;
      }

      case "like": {
        const targetUrl = requirePayloadText(payload.targetUrl, "targetUrl");
        await loadActionUrl(win, platform, action.actionType, targetUrl);
        remember(await confirmAuthenticatedPage(win, cdp, selectors, platform, action.actionType));
        remember(await cdp.clickFirst(selectors.likeButton, "like_button"));
        await cdp.waitForFirst(selectors.likedButton, "liked_state", 5_000);
        summary = `Liked post at ${targetUrl.slice(0, 50)}`;
        break;
      }

      case "follow": {
        const targetUrl = String(payload.targetUrl || payload.profileUrl || "");
        if (!targetUrl) throw browserVerificationFailed(platform, action.actionType, "missing targetUrl/profileUrl");
        await loadActionUrl(win, platform, action.actionType, targetUrl);
        remember(await confirmAuthenticatedPage(win, cdp, selectors, platform, action.actionType));
        remember(await cdp.clickFirst(selectors.followButton, "follow_button"));
        await cdp.waitForFirst(selectors.followingButton, "following_state", 5_000);
        summary = `Followed user at ${targetUrl.slice(0, 50)}`;
        break;
      }

      case "browse_feed": {
        const feedUrl = String(payload.url || getFeedUrl(platform));
        const maxPosts = Number(payload.maxPosts || 10);
        await loadActionUrl(win, platform, action.actionType, feedUrl);
        remember(await confirmAuthenticatedPage(win, cdp, selectors, platform, action.actionType));
        for (let i = 0; i < 3; i += 1) {
          await cdp.evaluate<void>("window.scrollBy(0, window.innerHeight)");
        }
        const posts = await cdp.waitForAnyText(selectors.feedItems);
        summary = `Browsed feed — found ${Math.min(posts.length, maxPosts)} posts`;
        break;
      }

      case "search": {
        const query = requirePayloadText(payload.query, "query");
        await loadActionUrl(win, platform, action.actionType, getSearchUrl(platform, query));
        remember(await confirmAuthenticatedPage(win, cdp, selectors, platform, action.actionType));
        const results = await cdp.waitForAnyText(selectors.searchItems);
        summary = `Search "${query.slice(0, 30)}" — ${results.length} results`;
        break;
      }

      case "screenshot": {
        const url = String(payload.url || getFeedUrl(platform));
        await loadActionUrl(win, platform, action.actionType, url);
        remember(await confirmAuthenticatedPage(win, cdp, selectors, platform, action.actionType));
        const title = await cdp.evaluate<string>("document.title");
        summary = `Screenshot captured: ${title}`;
        break;
      }

      default:
        throw new Error(`Unsupported browser action type: ${action.actionType}`);
    }

    assertNotCancelled();
    await captureScreenshot(win, screenshotPath, action.id, "success");
    await closeWindow(win);
    logActionTelemetry({
      platform,
      action_type: action.actionType,
      selector_hit: selectorHits.at(-1) ?? null,
      selector_hits: selectorHits,
      retries: cdp.getRetryCount(),
      duration_ms: Date.now() - startedAt,
      final_outcome: "success",
    });
    return {
      success: true,
      cancelled: false,
      summary,
      screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
      error: null,
    };
  } catch (error) {
    const wasCancelled = cancelledActionIds.has(action.id)
      || (error instanceof Error && error.message === "BROWSER_ACTION_CANCELLED");
    await captureScreenshot(win, screenshotPath, action.id, "failure");
    await closeWindow(win);

    const msg = wasCancelled ? "Action cancelled." : describeBrowserActionError(error);
    const finalOutcome = classifyBrowserOutcome(error, wasCancelled);
    if (!wasCancelled) {
      log.error(`[browser] Action ${action.actionType} failed: ${msg}`);
    }
    logActionTelemetry({
      platform,
      action_type: action.actionType,
      selector_hit: selectorHits.at(-1) ?? null,
      selector_hits: selectorHits,
      retries: cdp.getRetryCount(),
      duration_ms: Date.now() - startedAt,
      final_outcome: finalOutcome,
    });
    return {
      success: false,
      cancelled: wasCancelled,
      summary: wasCancelled ? "Action cancelled" : "Action failed",
      screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
      error: msg,
    };
  } finally {
    await cdp.dispose().catch(() => undefined);
    activeActionWindows.delete(action.id);
    cancelledActionIds.delete(action.id);
  }
}

async function confirmAuthenticatedPage(
  win: BrowserWindow,
  cdp: BrowserCdpClient,
  selectors: PlatformSelectors,
  platform: string,
  actionType: string,
): Promise<string> {
  await assertAuthenticatedPage(() => win.webContents.getURL(), platform, actionType);
  return cdp.waitForAuthenticatedSurface(
    selectors.authenticated,
    getPlatformRules(platform).authenticatedCookieNames,
  );
}

async function loadActionUrl(
  win: BrowserWindow,
  platform: string,
  actionType: string,
  url: string,
): Promise<void> {
  assertAllowedUrl(platform, url, actionType);
  await win.loadURL(url);
  await waitForLoad(win, 15000, { platform, actionType });
}

function requirePayloadText(value: unknown, key: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) {
    throw new Error(`Browser action payload missing ${key}.`);
  }
  return text;
}

async function captureScreenshot(
  win: BrowserWindow,
  screenshotPath: string,
  actionId: string,
  phase: "success" | "failure",
): Promise<void> {
  try {
    const image: NativeImage = await win.webContents.capturePage();
    if (!image.isEmpty()) {
      writeFileSync(screenshotPath, image.toPNG());
    }
  } catch (err) {
    log.warn(`[browser] ${phase} screenshot failed for action ${actionId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function closeWindow(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  await delay(250);
  if (!win.isDestroyed()) win.close();
}

function describeBrowserActionError(error: unknown): string {
  if (isAppError(error)) return `[${error.code}] ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function classifyBrowserOutcome(error: unknown, wasCancelled: boolean): BrowserActionOutcome {
  if (wasCancelled) return "cancelled";
  if (isAppError(error)) {
    if (error.code === "browser.not_logged_in") return "logged_out";
    if (error.code === "browser.selector_drift") return "selector_drift";
    if (error.code === "browser.verification_failed") return "verification_failed";
  }
  if (error instanceof Error && /429|rate[_ -]?limit|too many requests/i.test(error.message)) return "rate_limited";
  return "network";
}

function logActionTelemetry(telemetry: BrowserActionTelemetry): void {
  log.info("[browser] action telemetry", telemetry);
}
