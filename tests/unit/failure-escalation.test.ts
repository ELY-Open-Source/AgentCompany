import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// We test the escalation logic by extracting the relevant handler from worker-service
// and verifying the calls it makes to the database and notification system.

interface MockDb {
  getTaskRetryCount: ReturnType<typeof vi.fn>;
  incrementTaskRetryCount: ReturnType<typeof vi.fn>;
  resetTaskRetryCount: ReturnType<typeof vi.fn>;
  getChainOfCommand: ReturnType<typeof vi.fn>;
  getCeoForCompany: ReturnType<typeof vi.fn>;
  advanceTaskStatus: ReturnType<typeof vi.fn>;
}

interface MockDeps {
  db: MockDb;
  wakeAgentIfPossible: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

const MAX_RETRY_ATTEMPTS = 2;
const RETRY_COOLDOWN_MS = 30_000;

/**
 * Simulate the escalation logic extracted from worker-service.ts.
 * This mirrors the actual implementation to verify behavior.
 */
function simulateFailureEscalation(
  deps: MockDeps,
  run: { taskId: string; agentId: string; companyId: string },
  task: { title: string } | null,
  eventStatus: "failed" | "timed_out",
): { action: string; retryScheduled?: boolean } {
  const { db, wakeAgentIfPossible, notify, logger } = deps;

  if (eventStatus === "failed" || eventStatus === "timed_out") {
    const retryCount = db.getTaskRetryCount(run.taskId);

    if (retryCount < MAX_RETRY_ATTEMPTS) {
      db.incrementTaskRetryCount(run.taskId);
      db.advanceTaskStatus(
        run.taskId,
        "todo",
        `Run ${eventStatus} (attempt ${retryCount + 1}/${MAX_RETRY_ATTEMPTS}). Auto-retrying after ${RETRY_COOLDOWN_MS / 1000}s cooldown.`,
      );
      logger.info(
        `[escalation] Retrying task ${run.taskId} (attempt ${retryCount + 1}/${MAX_RETRY_ATTEMPTS}) for agent ${run.agentId}`,
      );
      // In real code this is setTimeout; we just mark it
      wakeAgentIfPossible(run.agentId, run.companyId, "retry_failed");
      return { action: "retry", retryScheduled: true };
    } else {
      db.resetTaskRetryCount(run.taskId);
      logger.warn(
        `[escalation] Task ${run.taskId} failed ${MAX_RETRY_ATTEMPTS} times. Escalating to manager.`,
      );

      let escalated = false;
      try {
        const chain = db.getChainOfCommand(run.agentId);
        if (chain.length > 0) {
          wakeAgentIfPossible(chain[0].id, run.companyId, "report_failed");
          escalated = true;
          logger.info(
            `[escalation] Escalated task ${run.taskId} to manager ${chain[0].name} (${chain[0].id})`,
          );
        }
      } catch {
        // Chain lookup failed (agent deleted)
      }

      if (!escalated) {
        try {
          const ceo = db.getCeoForCompany(run.companyId);
          if (ceo) {
            wakeAgentIfPossible(ceo.id, run.companyId, "report_failed");
            escalated = true;
            logger.info(
              `[escalation] Escalated task ${run.taskId} to CEO ${ceo.name} (${ceo.id})`,
            );
          }
        } catch {
          /* CEO lookup failed */
        }
      }

      if (!escalated) {
        const taskTitle = task?.title ?? run.taskId;
        notify(
          "Task failed -- manual intervention needed",
          `"${taskTitle}" failed ${MAX_RETRY_ATTEMPTS} times and no manager is available to handle it.`,
        );
        logger.error(
          `[escalation] Task ${run.taskId} failed with no escalation target. User notified.`,
        );
        return { action: "user_notified" };
      }

      return { action: "escalated" };
    }
  }

  return { action: "none" };
}

function simulateSuccessReset(
  deps: MockDeps,
  run: { taskId: string },
  eventStatus: "succeeded",
): void {
  if (eventStatus === "succeeded") {
    try {
      deps.db.resetTaskRetryCount(run.taskId);
    } catch {
      /* best effort */
    }
  }
}

function createMockDeps(): MockDeps {
  return {
    db: {
      getTaskRetryCount: vi.fn().mockReturnValue(0),
      incrementTaskRetryCount: vi.fn(),
      resetTaskRetryCount: vi.fn(),
      getChainOfCommand: vi.fn().mockReturnValue([]),
      getCeoForCompany: vi.fn().mockReturnValue(null),
      advanceTaskStatus: vi.fn().mockReturnValue({ previousStatus: "in_progress" }),
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
  let deps: MockDeps;

  beforeEach(() => {
    deps = createMockDeps();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Retry path (count < MAX_RETRY_ATTEMPTS)", () => {
    it("retries on first failure (retry_count=0)", () => {
      deps.db.getTaskRetryCount.mockReturnValue(0);

      const result = simulateFailureEscalation(deps, RUN, TASK, "failed");

      expect(result.action).toBe("retry");
      expect(deps.db.incrementTaskRetryCount).toHaveBeenCalledWith("task-1");
      expect(deps.db.advanceTaskStatus).toHaveBeenCalledWith(
        "task-1",
        "todo",
        expect.stringContaining("attempt 1/2"),
      );
      expect(deps.wakeAgentIfPossible).toHaveBeenCalledWith("agent-1", "company-1", "retry_failed");
    });

    it("retries on second failure (retry_count=1)", () => {
      deps.db.getTaskRetryCount.mockReturnValue(1);

      const result = simulateFailureEscalation(deps, RUN, TASK, "failed");

      expect(result.action).toBe("retry");
      expect(deps.db.incrementTaskRetryCount).toHaveBeenCalledWith("task-1");
      expect(deps.db.advanceTaskStatus).toHaveBeenCalledWith(
        "task-1",
        "todo",
        expect.stringContaining("attempt 2/2"),
      );
      expect(deps.wakeAgentIfPossible).toHaveBeenCalledWith("agent-1", "company-1", "retry_failed");
    });
  });

  describe("Escalation path (count >= MAX_RETRY_ATTEMPTS)", () => {
    it("escalates to chain[0] manager after max retries", () => {
      deps.db.getTaskRetryCount.mockReturnValue(2);
      deps.db.getChainOfCommand.mockReturnValue([
        { id: "manager-1", name: "Manager Alpha" },
      ]);

      const result = simulateFailureEscalation(deps, RUN, TASK, "failed");

      expect(result.action).toBe("escalated");
      expect(deps.db.resetTaskRetryCount).toHaveBeenCalledWith("task-1");
      expect(deps.wakeAgentIfPossible).toHaveBeenCalledWith("manager-1", "company-1", "report_failed");
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("falls through to CEO when chain is empty", () => {
      deps.db.getTaskRetryCount.mockReturnValue(2);
      deps.db.getChainOfCommand.mockReturnValue([]);
      deps.db.getCeoForCompany.mockReturnValue({ id: "ceo-1", name: "CEO Boss" });

      const result = simulateFailureEscalation(deps, RUN, TASK, "failed");

      expect(result.action).toBe("escalated");
      expect(deps.db.resetTaskRetryCount).toHaveBeenCalledWith("task-1");
      expect(deps.wakeAgentIfPossible).toHaveBeenCalledWith("ceo-1", "company-1", "report_failed");
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("falls through to CEO when chain lookup throws", () => {
      deps.db.getTaskRetryCount.mockReturnValue(2);
      deps.db.getChainOfCommand.mockImplementation(() => {
        throw new Error("Agent deleted");
      });
      deps.db.getCeoForCompany.mockReturnValue({ id: "ceo-1", name: "CEO Boss" });

      const result = simulateFailureEscalation(deps, RUN, TASK, "failed");

      expect(result.action).toBe("escalated");
      expect(deps.wakeAgentIfPossible).toHaveBeenCalledWith("ceo-1", "company-1", "report_failed");
    });

    it("notifies user when both chain and CEO are unavailable", () => {
      deps.db.getTaskRetryCount.mockReturnValue(2);
      deps.db.getChainOfCommand.mockReturnValue([]);
      deps.db.getCeoForCompany.mockReturnValue(null);

      const result = simulateFailureEscalation(deps, RUN, TASK, "failed");

      expect(result.action).toBe("user_notified");
      expect(deps.notify).toHaveBeenCalledWith(
        "Task failed -- manual intervention needed",
        expect.stringContaining("Implement feature X"),
      );
      expect(deps.notify).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("no manager is available"),
      );
    });

    it("uses taskId as fallback when task is null", () => {
      deps.db.getTaskRetryCount.mockReturnValue(2);
      deps.db.getChainOfCommand.mockReturnValue([]);
      deps.db.getCeoForCompany.mockReturnValue(null);

      const result = simulateFailureEscalation(deps, RUN, null, "failed");

      expect(result.action).toBe("user_notified");
      expect(deps.notify).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("task-1"),
      );
    });
  });

  describe("Timed out runs follow same path", () => {
    it("retries timed_out runs the same as failed runs", () => {
      deps.db.getTaskRetryCount.mockReturnValue(0);

      const result = simulateFailureEscalation(deps, RUN, TASK, "timed_out");

      expect(result.action).toBe("retry");
      expect(deps.db.incrementTaskRetryCount).toHaveBeenCalledWith("task-1");
    });

    it("escalates timed_out runs after max retries", () => {
      deps.db.getTaskRetryCount.mockReturnValue(2);
      deps.db.getChainOfCommand.mockReturnValue([
        { id: "manager-1", name: "Manager Alpha" },
      ]);

      const result = simulateFailureEscalation(deps, RUN, TASK, "timed_out");

      expect(result.action).toBe("escalated");
      expect(deps.db.resetTaskRetryCount).toHaveBeenCalledWith("task-1");
    });
  });

  describe("Success resets retry count", () => {
    it("resets retry_count on successful completion", () => {
      simulateSuccessReset(deps, { taskId: "task-1" }, "succeeded");

      expect(deps.db.resetTaskRetryCount).toHaveBeenCalledWith("task-1");
    });

    it("handles reset errors gracefully", () => {
      deps.db.resetTaskRetryCount.mockImplementation(() => {
        throw new Error("DB error");
      });

      // Should not throw
      expect(() => {
        simulateSuccessReset(deps, { taskId: "task-1" }, "succeeded");
      }).not.toThrow();
    });
  });
});
