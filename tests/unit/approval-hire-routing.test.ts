import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { handleApprovalResolved } from "../../src/main/automation/automation-approval-handler";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("hire approval routing", () => {
  it("approved subordinate hires wake the hire, requester, and CEO", async () => {
    const profileDir = await createTempDir("agentcompany-hire-routing-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });

    const companyId = db.saveCompany({
      name: "Hire Routing Co",
      description: "Tests recursive hire wake routing",
      status: "active",
    });
    const workspaceId = db.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const ceoId = db.saveAgent({
      companyId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });
    const ctoId = db.saveAgent({
      companyId,
      name: "CTO",
      role: "CTO",
      title: "Chief Technology Officer",
      status: "active",
      reportsTo: ceoId,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Lead engineering",
      budgetMonthlyUsd: 220,
      department: "engineering",
    });

    const { agentId: hireId, approvalId } = db.createHireRequest({
      companyId,
      requestedByAgentId: ctoId,
      name: "New Engineer",
      role: "Engineer",
      title: "Frontend Engineer",
      department: "engineering",
      reportsTo: ctoId,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      metadataJson: "{}",
      capabilities: "React, TypeScript, Tailwind",
      budgetMonthlyUsd: 180,
      payloadSummary: "Hire new engineer",
      impactSummary: "Need another IC under the CTO",
      payloadJson: "{}",
    });

    db.decideApproval({
      approvalId,
      state: "approved",
      decisionNote: "Approved by board",
    });

    const wakeAgentIfPossible = vi.fn().mockReturnValue(null);
    const dispatchAutomation = vi.fn();
    const notify = vi.fn();

    handleApprovalResolved({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      publishDomainChanged: () => {},
      notify,
      wakeAgentIfPossible,
      dispatchBrowserAction: async () => {},
      isQuitting: () => false,
    }, {
      dispatchAutomation,
      handleTaskStatusChange: vi.fn(),
      runWorkflowPipeline: async () => {},
      trackTimer: vi.fn(),
    }, approvalId, companyId, "approved");

    expect(db.getAgent(hireId).status).toBe("idle");
    expect(dispatchAutomation).toHaveBeenCalledWith("approval_resolved", expect.objectContaining({ companyId, agentId: ctoId }));
    expect(dispatchAutomation).toHaveBeenCalledWith("hire_approved", expect.objectContaining({ companyId, agentId: hireId }));
    expect(wakeAgentIfPossible).toHaveBeenCalledWith(hireId, companyId, "assignment");
    expect(wakeAgentIfPossible).toHaveBeenCalledWith(ceoId, companyId, "assignment");
    expect(wakeAgentIfPossible).toHaveBeenCalledWith(ctoId, companyId, "approval_resolved");
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("New Engineer"),
    }));

    db.close();
  });
});
