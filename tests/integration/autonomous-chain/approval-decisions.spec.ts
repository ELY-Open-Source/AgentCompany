/**
 * Step 4: Hire approval + decideApproval side effects.
 * Physically extracted from autonomous-chain.spec.ts without behavior changes.
 */

import { describe, expect, it } from "vitest";
import { installSharedSetup } from "./shared-setup";

const shared = installSharedSetup();
const { createAgent } = shared;

describe("Step 4: Hire approval + decideApproval", () => {
  it("decideApproval sets hired agent to idle when approved", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const hireId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "pending_approval" as "idle" });

    const approvalId = shared.db.requestApproval({
      companyId: shared.companyId,
      requestedByAgentId: ceoId,
      type: "hire_agent",
      payloadSummary: "Hire CTO",
      impactSummary: "Test impact",
      payloadJson: JSON.stringify({ agentId: hireId }),
    });

    shared.db.decideApproval({
      approvalId,
      state: "approved",
      decisionNote: "Approved by board",
    });

    const updatedAgent = shared.db.getAgent(hireId);
    expect(updatedAgent.status).toBe("idle");
  });

  it("decideApproval sets hired agent to terminated when rejected", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const hireId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "pending_approval" as "idle" });

    const approvalId = shared.db.requestApproval({
      companyId: shared.companyId,
      requestedByAgentId: ceoId,
      type: "hire_agent",
      payloadSummary: "Hire CTO",
      impactSummary: "Test impact",
      payloadJson: JSON.stringify({ agentId: hireId }),
    });

    shared.db.decideApproval({
      approvalId,
      state: "rejected",
      decisionNote: "Not needed",
    });

    const updatedAgent = shared.db.getAgent(hireId);
    expect(updatedAgent.status).toBe("terminated");
  });

  it("getApprovalRecord includes payloadJson", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const hireId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "pending_approval" as "idle" });
    const approvalId = shared.db.requestApproval({
      companyId: shared.companyId,
      requestedByAgentId: ceoId,
      type: "hire_agent",
      payloadSummary: "Hire CTO",
      impactSummary: "Test",
      payloadJson: JSON.stringify({ agentId: hireId, config: { connector: "codex_local" } }),
    });

    const approval = shared.db.getApprovalRecord(approvalId);
    expect(approval.payloadJson).toBeTruthy();
    const payload = JSON.parse(approval.payloadJson!);
    expect(payload.agentId).toBe(hireId);
  });
});
