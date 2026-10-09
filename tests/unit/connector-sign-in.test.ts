import { describe, expect, test } from "vitest";
import { judgeSignIn } from "../../src/renderer/src/pages/connectors/sign-in";

describe("connector sign-in", () => {
  test("ends connected or failed only on what the new account says; anything else keeps waiting", () => {
    const row = (id: string, status: string, pendingAccountId: string | null = null) => ({ id, status, pendingAccountId });
    expect(judgeSignIn(row("ca_new", "ACTIVE"), "ca_new")).toEqual({ outcome: "connected" });
    expect(judgeSignIn(row("ca_new", "FAILED"), "ca_new")).toEqual({ outcome: "failed", message: "The account is failed." });
    expect(judgeSignIn(row("ca_new", "EXPIRED"), "ca_new")).toEqual({ outcome: "failed", message: "The account is expired." });
    expect(judgeSignIn(row("ca_new", "INITIATED"), "ca_new")).toEqual({ outcome: "waiting" });
    expect(judgeSignIn(undefined, "ca_new")).toEqual({ outcome: "waiting" });
    // A reconnect waits while the new account is pending, and fails if it never takes over from the old one.
    expect(judgeSignIn(row("ca_old", "ACTIVE", "ca_new"), "ca_new")).toEqual({ outcome: "waiting" });
    expect(judgeSignIn(row("ca_old", "ACTIVE"), "ca_new")).toEqual({ outcome: "failed", message: "The new sign-in did not complete; the earlier connection is kept." });
  });
});
