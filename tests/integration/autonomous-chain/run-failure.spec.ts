/**
 * Step 6: Run failure escalation (database layer).
 * Physically extracted from autonomous-chain.spec.ts without behavior changes.
 */

import { describe, expect, it } from "vitest";
import { installSharedSetup } from "./shared-setup";

const shared = installSharedSetup();
const { createAgent } = shared;

describe("Step 6: Run failure escalation (database layer)", () => {
  it("finishRun marks run as failed and returns outcome", () => {
    const agentId = createAgent({ name: "IC", role: "Engineer" });
    const taskId = shared.db.saveTask({
      companyId: shared.companyId,
      title: "Failing task",
      description: "Will fail",
      assigneeAgentId: agentId,
      workspaceId: shared.workspaceId,
      priority: "medium",
      status: "in_progress",
    });

    const run = shared.db.createRun({
      companyId: shared.companyId,
      taskId,
      agentId,
      workspaceId: shared.workspaceId,
      connectorId: "openai-codex",
    });

    shared.db.markRunStatus(run.id, "running", "Started");

    const outcome = shared.db.finishRun({
      runId: run.id,
      status: "failed",
      summary: null,
      errorMessage: "Process crashed",
      exitCode: 1,
      signal: null,
      model: "gpt-5-codex",
      sessionDisplayId: null,
      unattributedCost: false,
    });

    expect(outcome.budgetHardStopped).toBe(false);

    const snapshot = shared.db.listSnapshot();
    const finishedRun = snapshot.runs.find((r) => r.id === run.id);
    expect(finishedRun?.status).toBe("failed");
    expect(finishedRun?.errorMessage).toBe("Process crashed");
  });

  it("getChainOfCommand returns manager for failure escalation", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ctoId });

    const chain = shared.db.getChainOfCommand(icId);
    // First in chain is the immediate manager (CTO)
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0].name).toBe("CTO");
  });
});
