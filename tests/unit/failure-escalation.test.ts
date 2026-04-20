import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  handleFailureEscalation,
  handleSuccessReset,
  type EscalationDeps,
} from "@main/worker/observability/failure-escalation";

/**
 * Tests for the retry-aware failure escalation pipeline.
 *
 * The escalation state machine:
 *   1. Task fails with retry_count < MAX_RETRY_ATTEMPTS (2) -> retry same agent after cooldown
 *   2. Task fails with retry_count >= MAX_RETRY_ATTEMPTS -> escalate to manager chain
 *   3. No manager in chain -> fall through to CEO
 *   4. No CEO available -> notify user
 *   5. Task succeeds -> reset retry count
 */

const MAX_RETRY_ATTEMPTS = 2;
const RETRY_COOLDOWN_MS = 30_000;

function createMockDeps(): EscalationDeps {
  return {
    db: {
      tasks: {
        getTaskRetryCount: vi.fn().mockReturnValue(0),
        incrementTaskRetryCount: vi.fn(),
        resetTaskRetryCount: vi.fn(),
        advanceTaskStatus: vi.fn().mockReturnValue({ previousStatus: "in_progress" }),
      },
      agents: {
        getChainOfCommand: vi.fn().mockReturnValue([]),
        getCeoForCompany: vi.fn().mockReturnValue(null),
      },
    },
    wakeAgentIfPossible: vi.fn().mockReturnValue("wake-id"),
    notify: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

const RUN = { taskId: "task-1", agentId: "agent-1", companyId: "company-1" };
const TASK = { title: "Implement feature X" };

describe("Failure Escalation Pipeline", () => {
  let deps: EscalationDeps;
  let scheduleRetry: ReturnType<typeof vi.fn<(fn: () => void, delayMs: number) => void>>;

  beforeEach(() => {
    deps = createMockDeps();
    scheduleRetry = vi.fn<(fn: () => void, delayMs: number) => void>();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Retry path (count < MAX_RETRY_ATTEMPTS)", () => {
    it("retries on first failure (retry_count=0)", () => {
      (deps.db.tasks.getTaskRetryCount as ReturnType<typeof vi.fn>).mockReturnValue(0);

      const result = handleFailureEscalation(
        deps, RUN, TASK, "failed", MAX_RETRY_ATTEMPTS, RETRY_COOLDOWN_MS, scheduleRetry,
      );

      expect(result.action).toBe("retry");
      expect(deps.db.tasks.incrementTaskRetryCount).toHaveBeenCalledWith("task-1");
      expect(deps.db.tasks.advanceTaskStatus).toHaveBeenCalledWith(
        "task-1",
        "todo",
        expect.stringContaining("attempt 1/2"),
      );
      expect(scheduleRetry).toHaveBeenCalled();
    });

    it("retries on second failure (retry_count=1)", () => {
      (deps.db.tasks.getTaskRetryCount as ReturnType<typeof vi.fn>).mockReturnValue(1);

      const result = handleFailureEscalation(
        deps, RUN, TASK, "failed", MAX_RETRY_ATTEMPTS, RETRY_COOLDOWN_MS, scheduleRetry,
      );

      expect(result.action).toBe("retry");
      expect(deps.db.tasks.incrementTaskRetryCount).toHaveBeenCalledWith("task-1");
      expect(deps.db.tasks.advanceTaskStatus).toHaveBeenCalledWith(
        "task-1",
        "todo",
        expect.stringContaining("attempt 2/2"),
      );
      expect(scheduleRetry).toHaveBeenCalled();
    });

    it("calls wakeAgentIfPossible via scheduleRetry callback", () => {
      (deps.db.tasks.getTaskRetryCount as ReturnType<typeof vi.fn>).mockReturnValue(0);

      handleFailureEscalation(
        deps, RUN, TASK, "failed", MAX_RETRY_ATTEMPTS, RETRY_COOLDOWN_MS, scheduleRetry,
      );

      // Invoke the scheduled callback synchronously to verify it wakes the agent
      const [fn] = scheduleRetry.mock.calls[0]!;
      fn();
      expect(deps.wakeAgentIfPossible).toHaveBeenCalledWith("agent-1", "company-1", "retry_failed");
    });
  });

  describe("Escalation path (count >= MAX_RETRY_ATTEMPTS)", () => {
    it("escalates to chain[0] manager after max retries", () => {
      (deps.db.tasks.getTaskRetryCount as ReturnType<typeof vi.fn>).mockReturnValue(2);
      (deps.db.agents.getChainOfCommand as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "manager-1", name: "Manager Alpha" },
      ]);

      const result = handleFailureEscalation(
        deps, RUN, TASK, "failed", MAX_RETRY_ATTEMPTS, RETRY_COOLDOWN_MS, scheduleRetry,
      );

      expect(result.action).toBe("escalated");
      expect(deps.db.tasks.resetTaskRetryCount).toHaveBeenCalledWith("task-1");
      expect(deps.wakeAgentIfPossible).toHaveBeenCalledWith("manager-1", "company-1", "report_failed");
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("falls through to CEO when chain is empty", () => {
      (deps.db.tasks.getTaskRetryCount as ReturnType<typeof vi.fn>).mockReturnValue(2);
      (deps.db.agents.getChainOfCommand as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (deps.db.agents.getCeoForCompany as ReturnType<typeof vi.fn>).mockReturnValue({ id: "ceo-1", name: "CEO Boss" });

      const result = handleFailureEscalation(
        deps, RUN, TASK, "failed", MAX_RETRY_ATTEMPTS, RETRY_COOLDOWN_MS, scheduleRetry,
      );

      expect(result.action).toBe("escalated");
      expect(deps.db.tasks.resetTaskRetryCount).toHaveBeenCalledWith("task-1");
      expect(deps.wakeAgentIfPossible).toHaveBeenCalledWith("ceo-1", "company-1", "report_failed");
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("falls through to CEO when chain lookup throws", () => {
      (deps.db.tasks.getTaskRetryCount as ReturnType<typeof vi.fn>).mockReturnValue(2);
      (deps.db.agents.getChainOfCommand as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Agent deleted");
      });
      (deps.db.agents.getCeoForCompany as ReturnType<typeof vi.fn>).mockReturnValue({ id: "ceo-1", name: "CEO Boss" });

      const result = handleFailureEscalation(
        deps, RUN, TASK, "failed", MAX_RETRY_ATTEMPTS, RETRY_COOLDOWN_MS, scheduleRetry,
      );

      expect(result.action).toBe("escalated");
      expect(deps.wakeAgentIfPossible).toHaveBeenCalledWith("ceo-1", "company-1", "report_failed");
    });

    it("notifies user when both chain and CEO are unavailable", () => {
      (deps.db.tasks.getTaskRetryCount as ReturnType<typeof vi.fn>).mockReturnValue(2);
      (deps.db.agents.getChainOfCommand as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (deps.db.agents.getCeoForCompany as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const result = handleFailureEscalation(
        deps, RUN, TASK, "failed", MAX_RETRY_ATTEMPTS, RETRY_COOLDOWN_MS, scheduleRetry,
      );

      expect(result.action).toBe("user_notified");
      expect(deps.notify).toHaveBeenCalledWith(
        expect.stringContaining("manual intervention"),
        expect.stringContaining("Implement feature X"),
      );
      expect(deps.notify).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("no manager is available"),
      );
    });

    it("uses taskId as fallback when task is null", () => {
      (deps.db.tasks.getTaskRetryCount as ReturnType<typeof vi.fn>).mockReturnValue(2);
      (deps.db.agents.getChainOfCommand as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (deps.db.agents.getCeoForCompany as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const result = handleFailureEscalation(
        deps, RUN, null, "failed", MAX_RETRY_ATTEMPTS, RETRY_COOLDOWN_MS, scheduleRetry,
      );

      expect(result.action).toBe("user_notified");
      expect(deps.notify).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("task-1"),
      );
    });
  });

  describe("Timed out runs follow same path", () => {
    it("retries timed_out runs the same as failed runs", () => {
      (deps.db.tasks.getTaskRetryCount as ReturnType<typeof vi.fn>).mockReturnValue(0);

      const result = handleFailureEscalation(
        deps, RUN, TASK, "timed_out", MAX_RETRY_ATTEMPTS, RETRY_COOLDOWN_MS, scheduleRetry,
      );

      expect(result.action).toBe("retry");
      expect(deps.db.tasks.incrementTaskRetryCount).toHaveBeenCalledWith("task-1");
    });

    it("escalates timed_out runs after max retries", () => {
      (deps.db.tasks.getTaskRetryCount as ReturnType<typeof vi.fn>).mockReturnValue(2);
      (deps.db.agents.getChainOfCommand as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "manager-1", name: "Manager Alpha" },
      ]);

      const result = handleFailureEscalation(
        deps, RUN, TASK, "timed_out", MAX_RETRY_ATTEMPTS, RETRY_COOLDOWN_MS, scheduleRetry,
      );

      expect(result.action).toBe("escalated");
      expect(deps.db.tasks.resetTaskRetryCount).toHaveBeenCalledWith("task-1");
    });
  });

  describe("Success resets retry count", () => {
    it("resets retry_count on successful completion", () => {
      handleSuccessReset(deps.db, "task-1");
      expect(deps.db.tasks.resetTaskRetryCount).toHaveBeenCalledWith("task-1");
    });

    it("handles reset errors gracefully", () => {
      (deps.db.tasks.resetTaskRetryCount as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("DB error");
      });

      expect(() => {
        handleSuccessReset(deps.db, "task-1");
      }).not.toThrow();
    });
  });
});
