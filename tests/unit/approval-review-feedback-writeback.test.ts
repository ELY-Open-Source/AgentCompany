import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { handleApprovalResolved } from "../../src/main/automation/automation-approval-handler";
import { createHeartbeat } from "../../src/main/orchestration/heartbeat";

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
  it.each(["rejected", "revision_requested"] as const)(
    "persists high-importance knowledge when the board returns %s on a deliverable",
    async (decision) => {
    const profileDir = await createTempDir("agentcompany-review-feedback-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.core.connectors.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });

    const companyId = db.core.company.saveCompany({
      name: "Review Feedback Co",
      description: "Tests review feedback knowledge writeback",
      status: "active",
    });
    const workspaceId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const agentId = db.core.agents.saveAgent({
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
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Draft market report",
      description: "Produce a market report with concrete evidence and business insight.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "in_review",
    });
    const documentId = db.core.documents.saveDocument({
      companyId,
      type: "knowledge_article",
      title: "Market report",
      content: "Draft report body",
      authorAgentId: agentId,
      status: "in_review",
    });
    const approvalId = db.core.approvals.requestApproval({
      companyId,
      relatedTaskId: taskId,
      requestedByAgentId: agentId,
      type: "deliverable_review",
      payloadSummary: "Review market report deliverable",
      impactSummary: "Board review required before the report is finalized.",
      payloadJson: JSON.stringify({ documentIds: [documentId] }),
    });

    db.core.approvals.decideApproval({
      approvalId,
      state: decision,
      decisionNote: "Add stronger competitor evidence and a clearer recommendation.",
    });

    const wakeAgentIfPossible = vi.fn().mockReturnValue(null);
    handleApprovalResolved({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      publishDomainChanged: () => {},
      notify: vi.fn(),
      wakeAgentIfPossible,
      queueBrowserActionExecution: () => {},
      isQuitting: () => false,
    }, {
      dispatchAutomation: vi.fn(),
      handleTaskStatusChange: vi.fn(),
      runWorkflowPipeline: async () => {},
      trackTimer: vi.fn(),
    }, approvalId, companyId, decision);

    const knowledgeEntries = db.projection.snapshot.listSnapshot().knowledgeBase.filter((entry) => entry.companyId === companyId);
    expect(knowledgeEntries).toHaveLength(1);
    expect(knowledgeEntries[0]?.category).toBe("lesson_learned");
    expect(knowledgeEntries[0]?.importance).toBe("high");
    expect(knowledgeEntries[0]?.referencedEntityType).toBe("task");
    expect(knowledgeEntries[0]?.referencedEntityId).toBe(taskId);
    expect(knowledgeEntries[0]?.content).toContain(decision);
    expect(knowledgeEntries[0]?.content).toContain("stronger competitor evidence");
    expect(wakeAgentIfPossible).toHaveBeenCalledWith(agentId, companyId, "revision_needed");
    expect(wakeAgentIfPossible).toHaveBeenCalledTimes(1);
    expect(db.core.entity.getTask(taskId).status).toBe("todo");
    const document = db.projection.snapshot.listSnapshot().documents.find((entry) => entry.id === documentId);
    expect(document?.status).toBe("draft");

    db.close();
    },
  );

  it("makes a revision request immediately checkoutable by the assignee heartbeat", async () => {
    const profileDir = await createTempDir("agentcompany-review-checkout-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.core.connectors.saveConnector({
      id: "openai-codex",
      model: "gpt-5.4",
      envBindingText: "",
      notes: "Test connector",
    });

    const companyId = db.core.company.saveCompany({
      name: "Review Checkout Co",
      description: "Tests review revision checkout",
      status: "active",
    });
    const workspaceId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const agentId = db.core.agents.saveAgent({
      companyId,
      name: "Research Lead",
      role: "Researcher",
      title: "Research Lead",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: "gpt-5.4",
      capabilities: "Research and synthesis",
      budgetMonthlyUsd: 180,
      department: "research",
    });
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Draft market report",
      description: "Produce a market report with concrete evidence and business insight.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "in_review",
    });
    const documentId = db.core.documents.saveDocument({
      companyId,
      type: "knowledge_article",
      title: "Market report",
      content: "Draft report body",
      authorAgentId: agentId,
      status: "in_review",
    });
    const approvalId = db.core.approvals.requestApproval({
      companyId,
      relatedTaskId: taskId,
      requestedByAgentId: agentId,
      type: "deliverable_review",
      payloadSummary: "Review market report deliverable",
      impactSummary: "Board review required before the report is finalized.",
      payloadJson: JSON.stringify({ documentIds: [documentId] }),
    });

    db.core.approvals.decideApproval({
      approvalId,
      state: "revision_requested",
      decisionNote: "Add stronger competitor evidence and a clearer recommendation.",
    });

    const dispatchRunToWorker = vi.fn();
    const heartbeat = createHeartbeat(
      {
        db,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        publishDomainChanged: vi.fn(),
        emitEvent: vi.fn(),
        notify: vi.fn(),
        createRunToken: () => "test-token",
        getApiPort: () => 3210,
        dispatchAutomation: vi.fn(),
        hasWorkerReady: () => true,
        enqueueWorkerRun: vi.fn(),
        isQuitting: () => false,
        listRuntimeSkillEntries: () => [],
        budgetService: {
          autoCloseExpiredIncidents: vi.fn(() => 0),
          evaluateBudgetGate: vi.fn(() => ({ allowed: true, blockedBy: [] })),
        } as never,
        checkpointEngine: { shouldPauseHeartbeat: () => false },
      },
      () => ({
        workspace: null,
        lockMode: "none",
        source: "none",
        observationPath: profileDir,
      }),
      () => null,
      dispatchRunToWorker,
      (filter) => db.core.runs.hasActiveRun(filter),
    );

    handleApprovalResolved({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      publishDomainChanged: () => {},
      notify: vi.fn(),
      wakeAgentIfPossible: heartbeat.wakeAgentIfPossible,
      queueBrowserActionExecution: () => {},
      isQuitting: () => false,
    }, {
      dispatchAutomation: vi.fn(),
      handleTaskStatusChange: vi.fn(),
      runWorkflowPipeline: async () => {},
      trackTimer: vi.fn(),
    }, approvalId, companyId, "revision_requested");

    const task = db.core.entity.getTask(taskId);
    expect(task.status).toBe("in_progress");
    expect(db.core.runs.hasActiveRun({ companyId, taskId, agentId })).toBe(true);
    expect(dispatchRunToWorker).toHaveBeenCalledTimes(1);
    expect(dispatchRunToWorker).toHaveBeenCalledWith(expect.objectContaining({
      companyId,
      task: expect.objectContaining({ id: taskId }),
      trigger: "revision_needed",
    }));

    db.close();
  });
});
