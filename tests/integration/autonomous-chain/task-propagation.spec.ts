/**
 * Step 5: Task status + comment wake propagation.
 * Physically extracted from autonomous-chain.spec.ts without behavior changes.
 */

import { describe, expect, it } from "vitest";
import { installSharedSetup } from "./shared-setup";

const shared = installSharedSetup();
const { createAgent } = shared;

describe("Step 5: Task status + comment wake propagation", () => {
  it("getChainOfCommand returns correct hierarchy", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO", reportsTo: null });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ctoId });

    const chain = shared.db.agents.getChainOfCommand(icId);
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(ctoId); // immediate manager
    expect(chain[1].id).toBe(ceoId); // top level
  });

  it("getChainOfCommand handles circular references safely", () => {
    // Create a potential cycle (shouldn't happen in practice, but guard against it)
    const agent1 = createAgent({ name: "Agent1" });
    // agent1 reports to no one (CEO), so chain should be empty
    const chain = shared.db.agents.getChainOfCommand(agent1);
    expect(chain).toHaveLength(0);
  });

  it("task tree supports parent-child relationships", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });

    const parentTaskId = shared.db.tasks.saveTask({
      companyId: shared.companyId,
      title: "Build feature X",
      description: "Top-level task",
      assigneeAgentId: ctoId,
      workspaceId: shared.workspaceId,
      priority: "high",
      status: "in_progress",
    });

    const childTaskId = shared.db.tasks.saveTask({
      companyId: shared.companyId,
      title: "Implement module A",
      description: "Subtask",
      assigneeAgentId: ctoId,
      parentId: parentTaskId,
      workspaceId: shared.workspaceId,
      priority: "medium",
      status: "todo",
    });

    const childTask = shared.db.entityCrud.getTask(childTaskId);
    expect(childTask.parentId).toBe(parentTaskId);

    const parentTask = shared.db.entityCrud.getTask(parentTaskId);
    expect(parentTask.assigneeAgentId).toBe(ctoId);
  });
});
