import type { Session } from "electron";
import { describe, expect, it } from "vitest";
import {
  assertAuthenticatedPage,
  assertAuthenticatedSession,
} from "../../src/main/browser/browser-action-auth";
import { getPlatformSelectors } from "../../src/main/browser/platform-selectors";

function fakeSession(cookiesByOrigin: Record<string, unknown[]>): Pick<Session, "cookies"> {
  return {
    cookies: {
      get: async ({ url }) => cookiesByOrigin[url ?? ""] ?? [],
    },
  } as Pick<Session, "cookies">;
}

describe("browser action runtime guards", () => {
  it("fails social actions before execution when the account session has no cookies", async () => {
    await expect(
      assertAuthenticatedSession(fakeSession({}), "twitter", "post"),
    ).rejects.toMatchObject({
      code: "browser.not_logged_in",
    });
  });

  it("rejects guest cookies for platforms with explicit auth cookies", async () => {
    await expect(
      assertAuthenticatedSession(
        fakeSession({ "https://x.com": [{ name: "guest_id", value: "present" }] }),
        "twitter",
        "post",
      ),
    ).rejects.toMatchObject({
      code: "browser.not_logged_in",
    });
  });

  it("accepts a persisted platform cookie before executing actions", async () => {
    await expect(
      assertAuthenticatedSession(
        fakeSession({ "https://x.com": [{ name: "auth_token", value: "present" }] }),
        "twitter",
        "post",
      ),
    ).resolves.toBeUndefined();
  });

  it("treats login redirects as an unauthenticated page state", async () => {
    await expect(
      assertAuthenticatedPage(() => "https://x.com/i/flow/login", "twitter", "post"),
    ).rejects.toMatchObject({
      code: "browser.not_logged_in",
    });
  });

  it("keeps platform selectors versioned outside the executor", () => {
    const twitter = getPlatformSelectors("twitter");
    const linkedin = getPlatformSelectors("linkedin");

    expect(twitter.editor).toContain("[data-testid='tweetTextarea_0']");
    expect(twitter.submit).toContain("[data-testid='tweetButton']");
    expect(linkedin.composerOpen).toContain("button.share-box-feed-entry__trigger");
    expect(linkedin.editor).toContain(".ql-editor[contenteditable='true']");
  });
});
