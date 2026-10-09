import { expect, test } from "vitest";
import { nextUp } from "../../src/renderer/src/pages/home/next-up";
import type { ApprovalRecord, TaskRecord } from "../../src/shared/domain";

const approval = (id: string, createdAt: string, state = "pending") => ({ id, state, createdAt }) as ApprovalRecord;
const task = (id: string, fields: Partial<TaskRecord>) =>
  ({ id, status: "backlog", priority: "normal", hold: null, createdAt: "2026-01-01T00:00:00.000Z", ...fields }) as TaskRecord;
const ids = (items: ReturnType<typeof nextUp>["needsYou"]) =>
  items.map((item) => (item.kind === "approval" ? item.approval.id : item.task.id));

test("decisions come first, oldest first, then work stopped until you act, most urgent first", () => {
  const result = nextUp(
    [approval("apr_new", "2026-01-03T00:00:00.000Z"), approval("apr_old", "2026-01-02T00:00:00.000Z"), approval("apr_done", "2026-01-01T00:00:00.000Z", "approved")],
    [
      task("tsk_low", { priority: "low", hold: { reason: "Blocked: needs a key", waitingOn: "operator", resumesAt: null } }),
      task("tsk_high", { priority: "high", hold: { reason: "Ran out of runs", waitingOn: "operator", resumesAt: null } }),
      task("tsk_cooldown", { hold: { reason: "Cooling down", waitingOn: "provider", resumesAt: "2026-01-04T00:00:00.000Z" } }),
      task("tsk_closed", { status: "done", hold: { reason: "Old", waitingOn: "operator", resumesAt: null } }),
    ],
  );
  expect(ids(result.needsYou)).toEqual(["apr_old", "apr_new", "tsk_high", "tsk_low"]);
  const held = result.needsYou[2];
  expect(held.kind === "held" && held.reason).toBe("Ran out of runs");
});

test("the next task in line is work under way before work not started, then by priority; held, waiting and finished work is not next", () => {
  const backlogHigh = task("tsk_backlog_high", { priority: "high" });
  const runningLow = task("tsk_running_low", { status: "in_progress", priority: "low" });
  const runningHigh = task("tsk_running_high", { status: "in_progress", priority: "high", createdAt: "2026-01-05T00:00:00.000Z" });
  const review = task("tsk_review", { status: "review", priority: "high" });
  const cooling = task("tsk_cooling", { status: "in_progress", priority: "high", hold: { reason: "Cooling", waitingOn: "provider", resumesAt: "2026-01-04T00:00:00.000Z" } });
  expect(nextUp([], [backlogHigh, runningLow, review, cooling]).next).toEqual({ kind: "next", task: runningLow });
  expect(nextUp([], [backlogHigh, runningLow, runningHigh]).next).toEqual({ kind: "next", task: runningHigh });
  expect(nextUp([], [backlogHigh]).next).toEqual({ kind: "next", task: backlogHigh });
  expect(nextUp([], [review, cooling, task("tsk_done", { status: "done" })]).next).toBeNull();
});
