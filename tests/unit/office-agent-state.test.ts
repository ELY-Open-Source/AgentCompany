import { expect, test } from "vitest";
import { officeStatus } from "../../src/renderer/src/pages/office/agent-state";
import type { TaskHold } from "../../src/shared/domain";

const blocked: TaskHold = { reason: "Blocked: needs the staging key", waitingOn: "operator", resumesAt: null };
const cooling: TaskHold = { reason: "Provider is cooling down", waitingOn: "provider", resumesAt: "2026-10-09T14:00:00.000Z" };
const task = (hold: TaskHold | null, status = "in_progress", assigneeAgentId: string | null = "agt_a", id = "tsk_1") => ({ id, assigneeAgentId, status, hold });
const pending = (taskId: string, state = "pending") => ({ sourceEntityType: "task", sourceEntityId: taskId, state });
const none = { runs: [], tasks: [], approvals: [] };

test("each state comes from real records", () => {
  expect(officeStatus("agt_a", none)).toEqual({ state: "idle", hold: null });
  expect(officeStatus("agt_a", { ...none, runs: [{ agentId: "agt_a", state: "queued" }] }).state).toBe("queued");
  expect(officeStatus("agt_a", { ...none, runs: [{ agentId: "agt_a", state: "running" }] }).state).toBe("running");
  expect(officeStatus("agt_a", { ...none, tasks: [task(cooling)] })).toEqual({ state: "cooldown", hold: cooling });
  expect(officeStatus("agt_a", { ...none, tasks: [task(blocked)] })).toEqual({ state: "blocked", hold: blocked });
  // A pending approval on the agent's open task blocks the agent before any hold is written.
  expect(officeStatus("agt_a", { ...none, tasks: [task(null)], approvals: [pending("tsk_1")] })).toEqual({ state: "blocked", hold: { reason: "Waiting for your approval.", waitingOn: "operator", resumesAt: null } });
});

test("running beats blocked, blocked beats cooldown, cooldown beats queued", () => {
  const queued = { agentId: "agt_a", state: "queued" };
  expect(officeStatus("agt_a", { ...none, runs: [{ agentId: "agt_a", state: "running" }], tasks: [task(blocked)] }).state).toBe("running");
  expect(officeStatus("agt_a", { ...none, runs: [queued], tasks: [task(cooling), task(blocked)] }).state).toBe("blocked");
  expect(officeStatus("agt_a", { ...none, runs: [queued], tasks: [task(cooling)], approvals: [pending("tsk_1")] }).state).toBe("blocked");
  expect(officeStatus("agt_a", { ...none, runs: [queued], tasks: [task(cooling)] }).state).toBe("cooldown");
});

test("only this agent's open work counts", () => {
  expect(officeStatus("agt_a", { ...none, runs: [{ agentId: "agt_b", state: "running" }] }).state).toBe("idle");
  expect(officeStatus("agt_a", { ...none, tasks: [task(blocked, "in_progress", "agt_b")] }).state).toBe("idle");
  expect(officeStatus("agt_a", { ...none, tasks: [task(blocked, "done")] }).state).toBe("idle");
  expect(officeStatus("agt_a", { ...none, tasks: [task(null, "in_progress", "agt_b")], approvals: [pending("tsk_1")] }).state).toBe("idle");
  expect(officeStatus("agt_a", { ...none, tasks: [task(null)], approvals: [pending("tsk_1", "approved")] }).state).toBe("idle");
});
