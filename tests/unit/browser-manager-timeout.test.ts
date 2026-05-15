import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserAction, BrowserActionResult } from "../../src/main/browser-manager";
import { BrowserManager } from "../../src/main/browser-manager";

const mocks = vi.hoisted(() => ({
  runAction: vi.fn(),
  fromPartition: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  session: {
    fromPartition: mocks.fromPartition,
  },
}));

vi.mock("electron-log/main.js", () => ({
  default: {
    info: vi.fn(),
    warn: mocks.logWarn,
    error: vi.fn(),
  },
}));

vi.mock("../../src/main/browser/browser-action-executor", () => ({
  assertAllowedUrl: vi.fn(),
  attachWindowSecurity: vi.fn(),
  getPlatformRules: vi.fn(() => ({
    loginUrl: "https://x.com/i/flow/login",
    cookieOrigins: [],
    authenticatedCookieNames: [],
  })),
  waitForLoad: vi.fn(),
  runAction: mocks.runAction,
}));

const ACTION_TIMEOUT_MS = 5 * 60 * 1000;
const tempDirs: string[] = [];

function createSession() {
  return {
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    clearStorageData: vi.fn(),
    clearCache: vi.fn(),
    clearAuthCache: vi.fn(),
    cookies: {
      get: vi.fn(async () => []),
    },
  };
}

function createAction(id: string): BrowserAction {
  return {
    id,
    socialAccountId: "social-1",
    platform: "twitter",
    actionType: "post",
    payload: { content: "hello" },
  };
}

function createActionWindow() {
  const win = {
    destroyed: false,
    close: vi.fn(() => {
      win.destroyed = true;
    }),
    isDestroyed: vi.fn(() => win.destroyed),
  };
  return win;
}

async function createProfileDir() {
  const dir = await mkdtemp(join(tmpdir(), "agentcompany-browser-timeout-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.useRealTimers();
  mocks.runAction.mockReset();
  mocks.fromPartition.mockReset();
  mocks.logWarn.mockReset();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("browser manager action timeout", () => {
  it("settles a hung action and starts the next queued action", async () => {
    const profileDir = await createProfileDir();
    const firstWindow = createActionWindow();
    const secondResult: BrowserActionResult = {
      success: true,
      cancelled: false,
      summary: "second action completed",
      screenshotPath: null,
      error: null,
    };

    mocks.fromPartition.mockReturnValue(createSession());
    mocks.runAction
      .mockImplementationOnce((action, _screenshotDir, _session, _cancelledActionIds, activeActionWindows) => {
        activeActionWindows.set(action.id, firstWindow);
        return new Promise(() => {});
      })
      .mockResolvedValueOnce(secondResult);

    vi.useFakeTimers();
    const manager = new BrowserManager(profileDir);

    const first = manager.executeAction(createAction("action-1"));
    await Promise.resolve();
    const second = manager.executeAction(createAction("action-2"));

    expect(mocks.runAction).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(ACTION_TIMEOUT_MS);
    await expect(first).resolves.toMatchObject({
      success: false,
      cancelled: true,
      summary: "Action timed out and was cancelled.",
      screenshotPath: null,
      error: "Action timed out.",
    });
    await expect(second).resolves.toEqual(secondResult);

    expect(firstWindow.close).toHaveBeenCalledTimes(1);
    expect(mocks.runAction).toHaveBeenCalledTimes(2);
  });
});
