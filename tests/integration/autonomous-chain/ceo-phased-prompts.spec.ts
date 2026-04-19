/**
 * Step 2: CEO phased prompts + pending approvals + credential escalation.
 * Physically extracted from autonomous-chain.spec.ts without behavior changes.
 */

import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../../src/main/prompt-builder";
import type { ApprovalRecord } from "../../../src/shared/types";
import { installSharedSetup } from "./shared-setup";

const shared = installSharedSetup();
const { createAgent, buildCtx } = shared;

describe("Step 2: CEO phased prompts", () => {
  it("Phase 0: shows team building instructions when no reports at all", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [], // truly no reports
      chainOfCommand: [],
      pendingApprovals: [],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Team Building Phase");
    // The rewritten prompt uses "Design a minimal org" instead of the
    // old "Design the Organization Structure" header. Check for both
    // the stable Step-2 marker and the new ordering guarantee that
    // blocks the self-loop the earlier prompt enabled.
    expect(prompt).toContain("Design a minimal org");
    expect(prompt).toContain("HIRES FIRST. STRATEGY APPROVAL LAST.");
    expect(prompt).toContain("Submit org strategy");
    expect(prompt).not.toContain("Awaiting Org Approval");
    expect(prompt).not.toContain("Goal Decomposition");
  });

  it("Phase 0.5: shows awaiting hire approvals when pending_approval hires exist but no org approval", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });

    const hireId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "pending_approval" as "idle" });
    const hire = shared.db.getAgent(hireId);

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [hire],
      chainOfCommand: [],
      pendingApprovals: [],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Awaiting Hire Approvals");
    expect(prompt).not.toContain("Team Building Phase");
    expect(prompt).not.toContain("Goal Decomposition");
  });

  it("Phase 1: shows awaiting org approval when pending approve_ceo_strategy exists", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [],
      chainOfCommand: [],
      pendingApprovals: [
        {
          id: "approval-1",
          companyId: shared.companyId,
          type: "approve_ceo_strategy",
          state: "pending",
          payloadSummary: "Org structure: CEO + CTO + CMO",
          impactSummary: "Team of 3",
          requestedByAgentId: ceoId,
          relatedTaskId: null,
          decisionNote: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as ApprovalRecord,
      ],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Awaiting Org Approval");
    expect(prompt).not.toContain("Team Building Phase");
    expect(prompt).not.toContain("Goal Decomposition");
  });

  it("Phase 2: shows normal executive instructions when active reports and no pending org approval", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "idle" });
    const cto = shared.db.getAgent(ctoId);

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [cto],
      chainOfCommand: [],
      pendingApprovals: [],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Executive / CEO");
    expect(prompt).toContain("Goal Decomposition");
    expect(prompt).toContain("Delegation");
    expect(prompt).toContain("Unblock & Coordinate");
    expect(prompt).not.toContain("Team Building Phase");
    expect(prompt).not.toContain("Awaiting Org Approval");
  });

  it("includes pending approvals section in prompt", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ctoId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId, status: "idle" });
    const cto = shared.db.getAgent(ctoId);

    const ctx = buildCtx({
      agentId: ceoId,
      directReports: [cto],
      chainOfCommand: [],
      pendingApprovals: [
        {
          id: "approval-x",
          companyId: shared.companyId,
          type: "secret_access",
          state: "pending",
          payloadSummary: "Need Twitter API keys",
          impactSummary: "",
          requestedByAgentId: ceoId,
          relatedTaskId: null,
          decisionNote: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as ApprovalRecord,
      ],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Pending Approvals");
    expect(prompt).toContain("Need Twitter API keys");
  });

  it("Manager prompt includes credential escalation guidance", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ceo = shared.db.getAgent(ceoId);
    const managerId = createAgent({ name: "CTO", role: "CTO", reportsTo: ceoId });
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: managerId });
    const ic = shared.db.getAgent(icId);

    const ctx = buildCtx({
      agentId: managerId,
      directReports: [ic],
      chainOfCommand: [ceo],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Break down work and delegate it");
  });

  it("IC prompt includes credential escalation guidance", () => {
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ceo = shared.db.getAgent(ceoId);
    const icId = createAgent({ name: "Dev", role: "Engineer", reportsTo: ceoId });

    const ctx = buildCtx({
      agentId: icId,
      directReports: [],
      chainOfCommand: [ceo],
    });

    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Your manager is auto-notified and will help");
    expect(prompt).toContain("explain what API key/account you need");
  });
});
