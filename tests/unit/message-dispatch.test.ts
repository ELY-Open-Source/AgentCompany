import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { createThreadIntegration } from "../../src/main/thread-integration";
import { dispatchAgentMessage, HUMAN_SENDER_ID } from "../../src/main/message-dispatch";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createScaffold(db: AppDatabase) {
  db.updateConnectorHealth({
    id: "openai-codex",
    status: "ready",
    authState: "authenticated",
    version: "test",
    lastError: null,
  });

  const companyId = db.saveCompany({
    name: "Message Dispatch Co",
    description: "Tests board wake and wait-state resolution",
    status: "active",
    executionMode: "ai_cofounder",
  });
  const workspaceId = db.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: "/tmp/message-dispatch",
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const ceoId = db.saveAgent({
    companyId,
    name: "CEO",
    role: "CEO",
    title: "Chief Executive Officer",
    status: "idle",
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
    status: "idle",
    reportsTo: ceoId,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Lead engineering",
    budgetMonthlyUsd: 200,
    department: "engineering",
  });
  const cmoId = db.saveAgent({
    companyId,
    name: "CMO",
    role: "CMO",
    title: "Chief Marketing Officer",
    status: "idle",
    reportsTo: ceoId,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Lead marketing",
    budgetMonthlyUsd: 200,
    department: "marketing",
  });
  const pendingId = db.saveAgent({
    companyId,
    name: "Pending Recruit",
    role: "IC",
    title: "Pending Hire",
    status: "pending_approval",
    reportsTo: ctoId,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Pending",
    budgetMonthlyUsd: 100,
    department: "engineering",
  });
  const terminatedId = db.saveAgent({
    companyId,
    name: "Former COO",
    role: "COO",
    title: "Former COO",
    status: "terminated",
    reportsTo: ceoId,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "No longer active",
    budgetMonthlyUsd: 100,
    department: "operations",
  });

  const taskId = db.saveTask({
    companyId,
    title: "Review architecture plan",
    description: "Need board feedback in the thread.",
    assigneeAgentId: ctoId,
    workspaceId,
    priority: "high",
    status: "todo",
  });

  return { companyId, workspaceId, ceoId, ctoId, cmoId, pendingId, terminatedId, taskId };
}

describe("message dispatch", () => {
  it("wakes top-level active agents for company messages and active agents for incident messages", async () => {
    const profileDir = await createTempDir("agentcompany-message-dispatch-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, ceoId, ctoId, cmoId } = createScaffold(db);
    const wakeAgentIfPossible = vi.fn().mockReturnValue(null);

    const companyResult = dispatchAgentMessage({
      db,
      wakeAgentIfPossible,
    }, {
      companyId,
      fromAgentId: HUMAN_SENDER_ID,
      fromHumanUser: true,
      channel: "company",
      body: "Board broadcast",
    });

    expect(companyResult.ok).toBe(true);
    if (!companyResult.ok) throw new Error("Expected company message dispatch to succeed.");
    expect(companyResult.data.wakeTargets).toEqual([ceoId]);

    const incidentResult = dispatchAgentMessage({
      db,
      wakeAgentIfPossible,
    }, {
      companyId,
      fromAgentId: HUMAN_SENDER_ID,
      fromHumanUser: true,
      channel: "incident",
      body: "Urgent issue",
    });

    expect(incidentResult.ok).toBe(true);
    if (!incidentResult.ok) throw new Error("Expected incident message dispatch to succeed.");
    expect(new Set(incidentResult.data.wakeTargets)).toEqual(new Set([ceoId, ctoId, cmoId]));

    db.close();
  });

  it("resolves only user_reply wait states for company-wide human messages, but scoped replies resolve thread wait states", async () => {
    const profileDir = await createTempDir("agentcompany-message-wait-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, ctoId, taskId } = createScaffold(db);
    const threadIntegration = createThreadIntegration({
      db,
      logger: { info: () => {}, error: () => {} },
    });

    threadIntegration.onTaskCreated(taskId, companyId);
    const thread = db.listThreads({
      companyId,
      type: "task",
      relatedEntityType: "task",
      relatedEntityId: taskId,
      limit: 1,
    })[0];

    if (!thread) {
      throw new Error("Expected task thread to exist.");
    }

    const replyWait = db.setThreadWaitState({
      threadId: thread.id,
      companyId,
      waitingFor: "user_reply",
      relatedApprovalId: null,
      reason: "Reply needed",
    });
    const reviewWait = db.setThreadWaitState({
      threadId: thread.id,
      companyId,
      waitingFor: "user_review",
      relatedApprovalId: null,
      reason: "Review needed",
    });
    const approvalWait = db.setThreadWaitState({
      threadId: thread.id,
      companyId,
      waitingFor: "user_approval",
      relatedApprovalId: "approval-1",
      reason: "Approval needed",
    });

    dispatchAgentMessage({
      db,
      onHumanMessage: (currentCompanyId, toAgentId, threadId, waitStateId) =>
        threadIntegration.onHumanMessage(currentCompanyId, toAgentId, threadId, waitStateId),
    }, {
      companyId,
      fromAgentId: HUMAN_SENDER_ID,
      fromHumanUser: true,
      channel: "company",
      body: "Board-wide update",
    });

    let unresolved = db.listThreadWaitStates(companyId);
    expect(unresolved.some((entry) => entry.id === replyWait.id)).toBe(false);
    expect(unresolved.some((entry) => entry.id === reviewWait.id)).toBe(true);

    dispatchAgentMessage({
      db,
      onHumanMessage: (currentCompanyId, toAgentId, threadId, waitStateId) =>
        threadIntegration.onHumanMessage(currentCompanyId, toAgentId, threadId, waitStateId),
    }, {
      companyId,
      fromAgentId: HUMAN_SENDER_ID,
      fromHumanUser: true,
      channel: "direct",
      toAgentId: ctoId,
      threadId: thread.id,
      body: "Specific reply for the thread",
    });

    unresolved = db.listThreadWaitStates(companyId);
    expect(unresolved.some((entry) => entry.id === reviewWait.id)).toBe(false);
    expect(unresolved.some((entry) => entry.id === approvalWait.id)).toBe(true);

    db.close();
  });
});
