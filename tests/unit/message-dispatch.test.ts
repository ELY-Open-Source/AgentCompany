import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { createThreadIntegration } from "../../src/main/thread-integration";
import { dispatchAgentMessage, HUMAN_SENDER_ID } from "../../src/main/messaging/dispatch";

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
  db.core.connectors.updateConnectorHealth({
    id: "openai-codex",
    status: "ready",
    authState: "authenticated",
    version: "test",
    lastError: null,
  });

  const companyId = db.core.company.saveCompany({
    name: "Message Dispatch Co",
    description: "Tests board wake and wait-state resolution",
    status: "active",
    executionMode: "ai_cofounder",
  });
  const workspaceId = db.core.workspaces.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: "/tmp/message-dispatch",
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const ceoId = db.core.agents.saveAgent({
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
  const ctoId = db.core.agents.saveAgent({
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
  const cmoId = db.core.agents.saveAgent({
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
  const pendingId = db.core.agents.saveAgent({
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
  const terminatedId = db.core.agents.saveAgent({
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

  const taskId = db.core.tasks.saveTask({
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
  it("wakes every active agent for company channel broadcasts (Slack-style all-hands)", async () => {
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
      body: "All-hands broadcast",
    });

    expect(companyResult.ok).toBe(true);
    if (!companyResult.ok) throw new Error("Expected company message dispatch to succeed.");
    expect(new Set(companyResult.data.wakeTargets)).toEqual(new Set([ceoId, ctoId, cmoId]));

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

  it("routes a DM addressed to one agent into the @mentioned agent's inbox (group-chat @mention visibility)", async () => {
    const profileDir = await createTempDir("agentcompany-message-mention-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, ceoId, ctoId } = createScaffold(db);
    const wakeAgentIfPossible = vi.fn().mockReturnValue(null);

    const result = dispatchAgentMessage({
      db,
      wakeAgentIfPossible,
    }, {
      companyId,
      fromAgentId: HUMAN_SENDER_ID,
      fromHumanUser: true,
      channel: "direct",
      toAgentId: ctoId,
      subject: "status",
      body: "Hi @CEO, please share a progress update, @CTO is on infra.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected dispatch to succeed.");
    expect(new Set(result.data.wakeTargets)).toEqual(new Set([ceoId, ctoId]));

    const ceoInbox = db.core.messages.listAgentInboxUnread(companyId, ceoId);
    expect(ceoInbox.map((entry) => entry.id)).toContain(result.data.id);
    const ctoInbox = db.core.messages.listAgentInboxUnread(companyId, ctoId);
    expect(ctoInbox.map((entry) => entry.id)).toContain(result.data.id);

    db.close();
  });

  it("redirects a DM's wake to the @mentioned agent instead of the DM recipient (chatroom semantics)", async () => {
    const profileDir = await createTempDir("agentcompany-message-redirect-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, ceoId, ctoId } = createScaffold(db);
    const wakeAgentIfPossible = vi.fn().mockReturnValue(null);

    const result = dispatchAgentMessage({
      db,
      wakeAgentIfPossible,
    }, {
      companyId,
      fromAgentId: HUMAN_SENDER_ID,
      fromHumanUser: true,
      channel: "direct",
      toAgentId: ctoId,
      subject: "progress",
      body: "@CEO 更新一下进度。",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected dispatch to succeed.");
    // CEO is the only wake target — the DM recipient (CTO) is NOT
    // woken because an explicit @mention overrides the implicit DM
    // recipient. This is what lets the operator say "@CEO" inside a
    // chat with CTO and have CEO (not CTO) take the turn.
    expect(result.data.wakeTargets).toEqual([ceoId]);

    // The message is still visible to CTO's inbox — they were the
    // addressed recipient — but CTO is not required to answer.
    const ctoInbox = db.core.messages.listAgentInboxUnread(companyId, ctoId);
    expect(ctoInbox.map((entry) => entry.id)).toContain(result.data.id);
    const ceoInbox = db.core.messages.listAgentInboxUnread(companyId, ceoId);
    expect(ceoInbox.map((entry) => entry.id)).toContain(result.data.id);

    db.close();
  });

  it("keeps __board__ out of wake targets even when the recipient is the human reader", async () => {
    const profileDir = await createTempDir("agentcompany-message-board-wake-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, ceoId } = createScaffold(db);
    const wakeAgentIfPossible = vi.fn().mockReturnValue(null);

    const result = dispatchAgentMessage({
      db,
      wakeAgentIfPossible,
    }, {
      companyId,
      fromAgentId: ceoId,
      channel: "direct",
      toAgentId: HUMAN_SENDER_ID,
      subject: "report",
      body: "Update ready for review.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected dispatch to succeed.");
    expect(result.data.wakeTargets).not.toContain(HUMAN_SENDER_ID);
    expect(wakeAgentIfPossible).not.toHaveBeenCalledWith(
      HUMAN_SENDER_ID,
      expect.anything(),
      expect.anything(),
    );

    db.close();
  });

  it("resolves only user_reply wait states for company-wide human messages, but scoped replies resolve thread wait states", async () => {
    const profileDir = await createTempDir("agentcompany-message-wait-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, ctoId, taskId } = createScaffold(db);
    const threadIntegration = createThreadIntegration({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    threadIntegration.onTaskCreated(taskId, companyId);
    const thread = db.core.threads.listThreads({
      companyId,
      type: "task",
      relatedEntityType: "task",
      relatedEntityId: taskId,
      limit: 1,
    })[0];

    if (!thread) {
      throw new Error("Expected task thread to exist.");
    }

    const replyWait = db.core.threads.setThreadWaitState({
      threadId: thread.id,
      companyId,
      waitingFor: "user_reply",
      relatedApprovalId: null,
      reason: "Reply needed",
    });
    const reviewWait = db.core.threads.setThreadWaitState({
      threadId: thread.id,
      companyId,
      waitingFor: "user_review",
      relatedApprovalId: null,
      reason: "Review needed",
    });
    const approvalWait = db.core.threads.setThreadWaitState({
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

    let unresolved = db.core.threads.listThreadWaitStates(companyId);
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

    unresolved = db.core.threads.listThreadWaitStates(companyId);
    expect(unresolved.some((entry) => entry.id === reviewWait.id)).toBe(false);
    expect(unresolved.some((entry) => entry.id === approvalWait.id)).toBe(true);

    db.close();
  });
});
