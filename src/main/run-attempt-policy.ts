export const DEFAULT_MAX_CONSECUTIVE_SELF_WAKES = 5;

export interface HeartbeatAttemptInput {
  kind: "heartbeat";
  trigger: string;
  activeRunCount: number;
  maxConcurrentRuns: number;
  lastStartedAtMs: number | null;
  cooldownMs: number;
  nowMs: number;
  bypassCooldown: boolean;
}

export interface TaskFailureAttemptInput {
  kind: "task_failure";
  retryCount: number;
  maxRetryAttempts: number;
}

export interface SelfWakeAttemptInput {
  kind: "self_wake";
  hasWorkToContinue: boolean;
  consecutiveSelfWakes: number;
  maxConsecutiveSelfWakes: number;
}

export type HeartbeatAttemptDecision =
  | { action: "run" }
  | { action: "skip"; reason: "max_concurrent_runs" | "cooldown"; waitMs?: number };

export type TaskFailureAttemptDecision =
  | { action: "retry"; attemptNumber: number }
  | { action: "escalate" };

export type SelfWakeAttemptDecision =
  | { action: "run" }
  | { action: "skip"; reason: "no_work" | "self_wake_exhausted" };

type RunAttemptInput =
  | HeartbeatAttemptInput
  | TaskFailureAttemptInput
  | SelfWakeAttemptInput;

type RunAttemptDecision =
  | HeartbeatAttemptDecision
  | TaskFailureAttemptDecision
  | SelfWakeAttemptDecision;

export function runAttemptKey(agentId: string, companyId: string): string {
  return `${companyId}:${agentId}`;
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`run-attempt policy: ${name} must be a non-negative integer`);
  }
}

function assertNonNegativeNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`run-attempt policy: ${name} must be a non-negative number`);
  }
}

export function decideRunAttempt(input: HeartbeatAttemptInput): HeartbeatAttemptDecision;
export function decideRunAttempt(input: TaskFailureAttemptInput): TaskFailureAttemptDecision;
export function decideRunAttempt(input: SelfWakeAttemptInput): SelfWakeAttemptDecision;
export function decideRunAttempt(input: RunAttemptInput): RunAttemptDecision {
  switch (input.kind) {
    case "heartbeat": {
      assertNonNegativeInteger("activeRunCount", input.activeRunCount);
      assertNonNegativeInteger("maxConcurrentRuns", input.maxConcurrentRuns);
      assertNonNegativeNumber("cooldownMs", input.cooldownMs);
      assertNonNegativeNumber("nowMs", input.nowMs);
      if (input.lastStartedAtMs !== null) {
        assertNonNegativeNumber("lastStartedAtMs", input.lastStartedAtMs);
      }

      if (input.activeRunCount >= input.maxConcurrentRuns) {
        return { action: "skip", reason: "max_concurrent_runs" };
      }

      if (!input.bypassCooldown && input.lastStartedAtMs !== null) {
        const elapsedMs = input.nowMs - input.lastStartedAtMs;
        if (elapsedMs < input.cooldownMs) {
          return {
            action: "skip",
            reason: "cooldown",
            waitMs: input.cooldownMs - elapsedMs,
          };
        }
      }

      return { action: "run" };
    }

    case "task_failure": {
      assertNonNegativeInteger("retryCount", input.retryCount);
      assertNonNegativeInteger("maxRetryAttempts", input.maxRetryAttempts);
      if (input.retryCount < input.maxRetryAttempts) {
        return { action: "retry", attemptNumber: input.retryCount + 1 };
      }
      return { action: "escalate" };
    }

    case "self_wake": {
      assertNonNegativeInteger("consecutiveSelfWakes", input.consecutiveSelfWakes);
      assertNonNegativeInteger("maxConsecutiveSelfWakes", input.maxConsecutiveSelfWakes);
      if (!input.hasWorkToContinue) {
        return { action: "skip", reason: "no_work" };
      }
      if (input.consecutiveSelfWakes >= input.maxConsecutiveSelfWakes) {
        return { action: "skip", reason: "self_wake_exhausted" };
      }
      return { action: "run" };
    }
  }
}
