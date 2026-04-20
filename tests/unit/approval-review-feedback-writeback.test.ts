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

describe("deliverable review feedback writeback", () => {
  it("persists high-importance knowledge when the board requests revisions on a deliverable", async () => {
    const profileDir = await createTempDir("agentcompany-review-feedback-");
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
      name: "Review Feedback Co",
      description: "Tests review feedback knowledge writeback",
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
    const agentId = db.agents.saveAgent({
      companyId,
      name: "Research Lead",
      role: "Researcher",
      title: "Research Lead",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Research and synthesis",
      budgetMonthlyUsd: 180,
      department: "research",
    });
    const taskId = db.tasks.saveTask({
      companyId,
      title: "Draft market report",
      description: "Produce a market report with concrete evidence and business insight.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "in_review",
    });
    const documentId = db.saveDocument({
      companyId,
      type: "knowledge_article",
      title: "Market report",
      content: "Draft report body",
      authorAgentId: agentId,
      status: "in_review",
    });
    const approvalId = db.requestApproval({
      companyId,
      relatedTaskId: taskId,
      requestedByAgentId: agentId,
      type: "deliverable_review",
      payloadSummary: "Review market report deliverable",
      impactSummary: "Board review required before the report is finalized.",
      payloadJson: JSON.stringify({ documentIds: [documentId] }),
    });

    db.decideApproval({
      approvalId,
      state: "revision_requested",
      decisionNote: "Add stronger competitor evidence and a clearer recommendation.",
    });

    const wakeAgentIfPossible = vi.fn().mockReturnValue(null);
    handleApprovalResolved({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      publishDomainChanged: () => {},
      notify: vi.fn(),
      wakeAgentIfPossible,
      dispatchBrowserAction: async () => {},
      isQuitting: () => false,
    }, {
      dispatchAutomation: vi.fn(),
      handleTaskStatusChange: vi.fn(),
      runWorkflowPipeline: async () => {},
      trackTimer: vi.fn(),
    }, approvalId, companyId, "revision_requested");

    const knowledgeEntries = db.listSnapshot().knowledgeBase.filter((entry) => entry.companyId === companyId);
    expect(knowledgeEntries).toHaveLength(1);
    expect(knowledgeEntries[0]?.category).toBe("lesson_learned");
    expect(knowledgeEntries[0]?.importance).toBe("high");
    expect(knowledgeEntries[0]?.referencedEntityType).toBe("task");
    expect(knowledgeEntries[0]?.referencedEntityId).toBe(taskId);
    expect(knowledgeEntries[0]?.content).toContain("revision_requested");
    expect(knowledgeEntries[0]?.content).toContain("stronger competitor evidence");
    expect(wakeAgentIfPossible).toHaveBeenCalledWith(agentId, companyId, "revision_needed");
    expect(db.entityCrud.getTask(taskId).status).toBe("in_progress");
    const document = db.listSnapshot().documents.find((entry) => entry.id === documentId);
    expect(document?.status).toBe("draft");

    db.close();
  });
});
