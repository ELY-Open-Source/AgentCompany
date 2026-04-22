import { BrowserWindow, session } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import log from "electron-log/main.js";
import type { BrowserAction, BrowserActionResult, QueuedAction } from "./browser/browser-types";
import { getPlatformRules, attachWindowSecurity, assertAllowedUrl, waitForLoad, runAction } from "./browser/browser-action-executor";
import { hasAuthenticatedCookie } from "./browser/browser-action-auth";

export type { BrowserAction, BrowserActionResult } from "./browser/browser-types";

/**
 * Hard ceiling for a single browser action end-to-end (navigation, screenshot,
 * login verification, scripted DOM interaction). A hung page would otherwise
 * block every queued action for the same account forever; the renderer cannot
 * be trusted to always call `cancelAction`. Five minutes matches the longest
 * legitimate flow (first-time OAuth with 2FA).
 */
const ACTION_TIMEOUT_MS = 5 * 60 * 1000;

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

    const resolvedRoot = resolve(this.screenshotDir);
    await Promise.all(
      screenshotPaths
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        .filter((screenshotPath) => {
          const resolvedPath = resolve(screenshotPath);
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

    const rules = getPlatformRules(platform);
    const url = loginUrl || rules.loginUrl;
    const ses = this.getSession(socialAccountId);

    assertAllowedUrl(platform, url, "login");

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
    attachWindowSecurity(win, platform);

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
        const result = await this.runActionWithDeadline(item.action);
        item.resolve(result);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.processing.delete(socialAccountId);
  }

  private runActionWithDeadline(action: BrowserAction): Promise<BrowserActionResult> {
    // cancelAction reuses the same cancelledActionIds set + closes the active
    // window, which runAction observes to return a cancelled result. Mirror
    // that path on timeout so queued follow-ups are unblocked.
    return new Promise<BrowserActionResult>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        this.cancelledActionIds.add(action.id);
        const activeWindow = this.activeActionWindows.get(action.id);
        if (activeWindow && !activeWindow.isDestroyed()) {
          activeWindow.close();
        }
        log.warn(`[browser] action ${action.id} exceeded ${ACTION_TIMEOUT_MS}ms timeout`);
      }, ACTION_TIMEOUT_MS);

      runAction(
        action,
        this.screenshotDir,
        this.getSession(action.socialAccountId),
        this.cancelledActionIds,
        this.activeActionWindows,
      ).then(
        (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private async verifyLoginSession(socialAccountId: string, platform: string): Promise<boolean> {
    const ses = this.getSession(socialAccountId);
    const rules = getPlatformRules(platform);
    const cookieSets = await Promise.all(
      rules.cookieOrigins.map(async (origin) => {
        try {
          return await ses.cookies.get({ url: origin });
        } catch (err) {
          log.warn(`[browser-manager] cookies.get failed for origin ${origin}:`, err instanceof Error ? err.message : String(err));
          return [];
        }
      }),
    );
    const hasCookies = hasAuthenticatedCookie(cookieSets, rules.authenticatedCookieNames);
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
      await waitForLoad(verificationWindow, 10000);
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

  async extractProfileFromSession(socialAccountId: string, platform: string): Promise<{ accountName: string; displayName: string }> {
    const ses = this.getSession(socialAccountId);
    const win = new BrowserWindow({
      show: false,
      webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true },
    });

    try {
      const rules = getPlatformRules(platform);
      await win.loadURL(rules.authCheckUrl);
      await waitForLoad(win, 12000);
      const result = await win.webContents.executeJavaScript(`
        (() => {
          const meta = document.querySelector('meta[property="al:ios:url"], meta[name="user-login"], meta[property="profile:username"]');
          if (meta) return { accountName: meta.getAttribute("content") || "", displayName: "" };
          const title = document.title || "";
          return { accountName: "", displayName: title.split(/[|–—\\-/]/).map(s => s.trim()).find(s => s.length > 0 && s.length < 40) || "" };
        })()
      `);
      return result && (result.accountName || result.displayName) ? result : { accountName: "", displayName: "" };
    } catch (err) {
      log.warn(`[browser-manager] extractProfileFromSession evaluation failed:`, err instanceof Error ? err.message : String(err));
      return { accountName: "", displayName: "" };
    } finally {
      if (!win.isDestroyed()) win.close();
    }
  }

  async shutdown() {
    // Wait for each pending window-close to finish so any callers that chain
    // `await shutdown()` before recreating the manager don't observe torn
    // state (half-closed login windows still holding a partition).
    const closePromises: Promise<void>[] = [];
    for (const [, win] of this.loginWindows) {
      if (!win.isDestroyed()) {
        closePromises.push(
          new Promise<void>((resolve) => {
            win.once("closed", () => resolve());
            win.close();
          }),
        );
      }
    }
    await Promise.all(closePromises);
    this.loginWindows.clear();
    this.activeActionWindows.clear();
    this.cancelledActionIds.clear();
    this.queues.clear();
    this.processing.clear();
  }
}
