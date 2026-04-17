/**
 * Step 3: Deferred wake queue lifecycle.
 * Physically extracted from autonomous-chain.spec.ts without behavior changes.
 */

import { describe, expect, it } from "vitest";
import { installSharedSetup } from "./shared-setup";

const shared = installSharedSetup();
const { createAgent } = shared;

describe("Step 3: Wakeup request lifecycle (database)", () => {
  it("enqueue and list wakeup requests with coalescing", () => {
    const agentId = createAgent({ name: "TestAgent" });

    // Enqueue two wakes for the same busy agent. Coalesced into one row
    // with trigger_detail JSON array containing both triggers.
    shared.db.enqueueWakeupRequest(shared.companyId, agentId, "subtask_completed", "subtask_completed");
    shared.db.enqueueWakeupRequest(shared.companyId, agentId, "comment", "comment");

    // List returns the coalesced wake
    const wakes = shared.db.listWakeupRequests(shared.companyId, { agentId, status: "queued" });
    expect(wakes).toHaveLength(1);
    expect(wakes[0].companyId).toBe(shared.companyId);
    expect(wakes[0].coalescedCount).toBe(1);

    const triggers = JSON.parse(wakes[0].triggerDetail!);
    expect(triggers).toHaveLength(2);
    expect(triggers[0].trigger).toBe("subtask_completed");
    expect(triggers[1].trigger).toBe("comment");
  });

  it("returns empty array when no wakeup requests exist", () => {
    const agentId = createAgent({ name: "TestAgent" });
    const wakes = shared.db.listWakeupRequests(shared.companyId, { agentId, status: "queued" });
    expect(wakes).toHaveLength(0);
  });

  it("does not return wakes for other agents", () => {
    const agent1 = createAgent({ name: "Agent1" });
    const agent2 = createAgent({ name: "Agent2" });

    shared.db.enqueueWakeupRequest(shared.companyId, agent1, "comment", "comment");
    shared.db.enqueueWakeupRequest(shared.companyId, agent2, "subtask_completed", "subtask_completed");

    const wakes1 = shared.db.listWakeupRequests(shared.companyId, { agentId: agent1, status: "queued" });
    expect(wakes1).toHaveLength(1);
    expect(wakes1[0].source).toBe("comment");

    // Agent2's wake should still be there
    const wakes2 = shared.db.listWakeupRequests(shared.companyId, { agentId: agent2, status: "queued" });
    expect(wakes2).toHaveLength(1);
    expect(wakes2[0].source).toBe("subtask_completed");
  });
});
