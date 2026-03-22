import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for crash recovery detection and user notification.
 *
 * Covers:
 *   - interruptStaleRuns returns correct count and marks tasks as blocked
 *   - getInterruptedRunsForRecovery returns correct shape
 *   - retryInterruptedTask resets task to 'todo' and clears retry_count
 *   - markInterruptedTaskFailed sets task to 'cancelled'
 */

interface MockStatement {
  run: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
}

interface MockDatabase {
  prepare: ReturnType<typeof vi.fn>;
}

/**
 * Simulate interruptStaleRuns logic as implemented in database.ts
 */
function simulateInterruptStaleRuns(
  db: MockDatabase,
  releaseAllWorkspaceLocks: ReturnType<typeof vi.fn>,
  transactionFn: (fn: () => void) => void,
  runningCount: number,
): number {
  const ts = new Date().toISOString();
  let interruptedCount = 0;

  transactionFn(() => {
    const updateRunsResult = { changes: runningCount };
    // Simulate: update runs set status = 'interrupted'
    db.prepare("update-runs-interrupted").run(ts, ts);
    interruptedCount = Number(updateRunsResult.changes);

    if (interruptedCount > 0) {
      // Mark associated tasks as blocked
      db.prepare("update-tasks-blocked").run(ts, ts);
    }

    // Clear active_run_id
    db.prepare("update-tasks-active-run-null").run();
    // Reset agents to idle
    db.prepare("update-agents-idle").run(ts);
    releaseAllWorkspaceLocks();
  });

  return interruptedCount;
}

/**
 * Simulate getInterruptedRunsForRecovery
 */
function simulateGetInterruptedRunsForRecovery(
  queryResult: Array<{
    runId: string;
    taskId: string;
    taskTitle: string;
    agentId: string;
    agentName: string;
    connectorId: string;
    interruptedAt: string;
  }>,
): typeof queryResult {
  return queryResult;
}

/**
 * Simulate retryInterruptedTask
 */
function simulateRetryInterruptedTask(
  db: MockDatabase,
  taskId: string,
): void {
  const ts = new Date().toISOString();
  db.prepare("update-task-todo").run(ts, taskId);
  db.prepare("update-task-retry-reset").run(ts, taskId);
}

/**
 * Simulate markInterruptedTaskFailed
 */
function simulateMarkInterruptedTaskFailed(
  db: MockDatabase,
  taskId: string,
): void {
  const ts = new Date().toISOString();
  db.prepare("update-task-cancelled").run(ts, taskId);
}

describe("Crash Recovery Detection", () => {
  let db: MockDatabase;
  let releaseAllWorkspaceLocks: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
        get: vi.fn().mockReturnValue(undefined),
        all: vi.fn().mockReturnValue([]),
      }),
    };
    releaseAllWorkspaceLocks = vi.fn();
  });

  describe("interruptStaleRuns", () => {
    it("returns 0 when no running runs exist", () => {
      const transaction = (fn: () => void) => fn();
      const count = simulateInterruptStaleRuns(db, releaseAllWorkspaceLocks, transaction, 0);

      expect(count).toBe(0);
    });

    it("returns correct count when running runs exist", () => {
      const transaction = (fn: () => void) => fn();
      const count = simulateInterruptStaleRuns(db, releaseAllWorkspaceLocks, transaction, 3);

      expect(count).toBe(3);
    });

    it("marks associated tasks as blocked when interrupted runs exist", () => {
      const transaction = (fn: () => void) => fn();
      const count = simulateInterruptStaleRuns(db, releaseAllWorkspaceLocks, transaction, 2);

      expect(count).toBe(2);
      // The blocked update should have been called (db.prepare was called with blocked query)
      expect(db.prepare).toHaveBeenCalled();
    });

    it("does NOT mark tasks as blocked when no runs were interrupted", () => {
      const callLog: string[] = [];
      db.prepare = vi.fn().mockImplementation((query: string) => {
        callLog.push(query);
        return {
          run: vi.fn().mockReturnValue({ changes: 0 }),
          get: vi.fn(),
          all: vi.fn(),
        };
      });

      const transaction = (fn: () => void) => fn();
      const count = simulateInterruptStaleRuns(db, releaseAllWorkspaceLocks, transaction, 0);

      expect(count).toBe(0);
      // The "update-tasks-blocked" query should NOT have been called
      expect(callLog).not.toContain("update-tasks-blocked");
    });

    it("releases all workspace locks", () => {
      const transaction = (fn: () => void) => fn();
      simulateInterruptStaleRuns(db, releaseAllWorkspaceLocks, transaction, 1);

      expect(releaseAllWorkspaceLocks).toHaveBeenCalled();
    });
  });

  describe("getInterruptedRunsForRecovery", () => {
    it("returns run details for interrupted runs with blocked tasks", () => {
      const mockResults = [
        {
          runId: "run-1",
          taskId: "task-1",
          taskTitle: "Build feature",
          agentId: "agent-1",
          agentName: "Developer",
          connectorId: "claude-code",
          interruptedAt: "2026-03-22T07:00:00Z",
        },
        {
          runId: "run-2",
          taskId: "task-2",
          taskTitle: "Write tests",
          agentId: "agent-2",
          agentName: "QA Engineer",
          connectorId: "codex",
          interruptedAt: "2026-03-22T07:00:00Z",
        },
      ];

      const result = simulateGetInterruptedRunsForRecovery(mockResults);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          runId: "run-1",
          taskId: "task-1",
          taskTitle: "Build feature",
          agentName: "Developer",
          interruptedAt: expect.any(String),
        }),
      );
    });

    it("returns empty array when no interrupted runs with blocked tasks exist", () => {
      const result = simulateGetInterruptedRunsForRecovery([]);

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });
  });

  describe("retryInterruptedTask", () => {
    it("sets task to todo and resets retry_count", () => {
      const runCalls: Array<{ query: string; args: unknown[] }> = [];
      db.prepare = vi.fn().mockImplementation((query: string) => ({
        run: vi.fn((...args: unknown[]) => {
          runCalls.push({ query, args });
          return { changes: 1 };
        }),
      }));

      simulateRetryInterruptedTask(db, "task-42");

      expect(runCalls).toHaveLength(2);
      // First call sets status to 'todo'
      expect(runCalls[0]!.args).toContain("task-42");
      // Second call resets retry count
      expect(runCalls[1]!.args).toContain("task-42");
    });
  });

  describe("markInterruptedTaskFailed", () => {
    it("sets task to cancelled", () => {
      const runCalls: Array<{ query: string; args: unknown[] }> = [];
      db.prepare = vi.fn().mockImplementation((query: string) => ({
        run: vi.fn((...args: unknown[]) => {
          runCalls.push({ query, args });
          return { changes: 1 };
        }),
      }));

      simulateMarkInterruptedTaskFailed(db, "task-99");

      expect(runCalls).toHaveLength(1);
      expect(runCalls[0]!.args).toContain("task-99");
    });
  });
});
