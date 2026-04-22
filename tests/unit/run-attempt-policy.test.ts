import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_CONSECUTIVE_SELF_WAKES,
  decideRunAttempt,
  runAttemptKey,
} from "@main/run-attempt-policy";

describe("run-attempt policy", () => {
  describe("heartbeat dispatch", () => {
    it("allows heartbeat when concurrency and cooldown gates pass", () => {
      const decision = decideRunAttempt({
        kind: "heartbeat",
        trigger: "timer",
        activeRunCount: 0,
        maxConcurrentRuns: 1,
        lastStartedAtMs: 1_000,
        cooldownMs: 10_000,
        nowMs: 12_000,
        bypassCooldown: false,
      });

      expect(decision).toEqual({ action: "run" });
    });

    it("blocks heartbeat when active runs reach the policy ceiling", () => {
      const decision = decideRunAttempt({
        kind: "heartbeat",
        trigger: "timer",
        activeRunCount: 1,
        maxConcurrentRuns: 1,
        lastStartedAtMs: null,
        cooldownMs: 10_000,
        nowMs: 12_000,
        bypassCooldown: false,
      });

      expect(decision).toEqual({ action: "skip", reason: "max_concurrent_runs" });
    });

    it("blocks timer heartbeat inside cooldown and reports remaining wait", () => {
      const decision = decideRunAttempt({
        kind: "heartbeat",
        trigger: "timer",
        activeRunCount: 0,
        maxConcurrentRuns: 1,
        lastStartedAtMs: 10_000,
        cooldownMs: 30_000,
        nowMs: 25_000,
        bypassCooldown: false,
      });

      expect(decision).toEqual({ action: "skip", reason: "cooldown", waitMs: 15_000 });
    });

    it("allows message wakes to bypass cooldown", () => {
      const decision = decideRunAttempt({
        kind: "heartbeat",
        trigger: "message",
        activeRunCount: 0,
        maxConcurrentRuns: 1,
        lastStartedAtMs: 10_000,
        cooldownMs: 30_000,
        nowMs: 25_000,
        bypassCooldown: true,
      });

      expect(decision).toEqual({ action: "run" });
    });
  });

  describe("task failure attempts", () => {
    it("retries while the task is under its retry budget", () => {
      const decision = decideRunAttempt({
        kind: "task_failure",
        retryCount: 1,
        maxRetryAttempts: 2,
      });

      expect(decision).toEqual({ action: "retry", attemptNumber: 2 });
    });

    it("escalates when the retry budget is exhausted", () => {
      const decision = decideRunAttempt({
        kind: "task_failure",
        retryCount: 2,
        maxRetryAttempts: 2,
      });

      expect(decision).toEqual({ action: "escalate" });
    });
  });

  describe("self-wake continuation", () => {
    it("allows self-wake when work remains under the continuation budget", () => {
      const decision = decideRunAttempt({
        kind: "self_wake",
        hasWorkToContinue: true,
        consecutiveSelfWakes: DEFAULT_MAX_CONSECUTIVE_SELF_WAKES - 1,
        maxConsecutiveSelfWakes: DEFAULT_MAX_CONSECUTIVE_SELF_WAKES,
      });

      expect(decision).toEqual({ action: "run" });
    });

    it("skips self-wake when there is no remaining work", () => {
      const decision = decideRunAttempt({
        kind: "self_wake",
        hasWorkToContinue: false,
        consecutiveSelfWakes: 0,
        maxConsecutiveSelfWakes: DEFAULT_MAX_CONSECUTIVE_SELF_WAKES,
      });

      expect(decision).toEqual({ action: "skip", reason: "no_work" });
    });

    it("skips self-wake when the continuation budget is exhausted", () => {
      const decision = decideRunAttempt({
        kind: "self_wake",
        hasWorkToContinue: true,
        consecutiveSelfWakes: DEFAULT_MAX_CONSECUTIVE_SELF_WAKES,
        maxConsecutiveSelfWakes: DEFAULT_MAX_CONSECUTIVE_SELF_WAKES,
      });

      expect(decision).toEqual({ action: "skip", reason: "self_wake_exhausted" });
    });
  });

  it("keys attempt history by company and agent", () => {
    expect(runAttemptKey("agent-1", "company-1")).toBe("company-1:agent-1");
  });

  it("rejects invalid counters loudly", () => {
    expect(() =>
      decideRunAttempt({
        kind: "task_failure",
        retryCount: -1,
        maxRetryAttempts: 2,
      }),
    ).toThrow("retryCount");
  });
});
