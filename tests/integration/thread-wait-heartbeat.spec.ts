import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { createThreadIntegration } from "../../src/main/thread-integration";
import { createCheckpointEngine } from "../../src/main/checkpoint-engine";
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

function createNoopLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function createScaffold(db: AppDatabase) {
  db.updateConnectorHealth({
    id: "openai-codex",
    status: "ready",
    authState: "authenticated",
    version: "test",
    lastError: null,
  });

  const companyId = db.saveCompany({
    name: "Thread Wait Co",
    description: "Tests cofounder wait states and replies",
    status: "active",
    executionMode: "ai_cofounder",
  });
  const workspaceId = db.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: "/tmp/thread-wait",
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
  const engineerId = db.saveAgent({
    companyId,
    name: "Engineer",
    role: "Engineer",
    title: "Lead Engineer",
    status: "idle",
    reportsTo: ceoId,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Ship features",
    budgetMonthlyUsd: 180,
  });
  const taskId = db.saveTask({
    companyId,
    title: "Ship the feature",
    description: "Implement the approved deliverable and wait for co-founder review.",
    assigneeAgentId: engineerId,
    workspaceId,
    priority: "high",
    status: "in_progress",
  });

  return { companyId, workspaceId, ceoId, engineerId, taskId };
}

describe("thread wait + heartbeat integration", () => {
  it("pauses the assignee heartbeat on successful run completion until a human reply resolves the wait state", async () => {
    const profileDir = await createTempDir("agentcompany-thread-wait-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, engineerId, taskId } = createScaffold(db);
    const notifications: Array<{ title: string; body: string }> = [];

    const threadIntegration = createThreadIntegration({
      db,
      logger: createNoopLogger(),
      notify: (notification) => {
        notifications.push(notification);
      },
    });
    const checkpointEngine = createCheckpointEngine({
      db,
      logger: createNoopLogger(),
      threadIntegration,
      publishDomainChanged: () => {},
      notify: () => {},
    });

    threadIntegration.onTaskCreated(taskId, companyId);
    threadIntegration.onRunFinished("run-1", taskId, engineerId, companyId, "succeeded", null);

    const thread = db.listThreads({
      companyId,
      type: "task",
      relatedEntityType: "task",
      relatedEntityId: taskId,
      limit: 1,
    })[0];

    if (!thread) {
      throw new Error("Expected a task thread to exist for the completed run.");
    }

    let waitStates = db.listThreadWaitStates(companyId).filter((entry) => entry.threadId === thread.id);
    expect(waitStates).toHaveLength(1);
    expect(waitStates[0]?.waitingFor).toBe("user_reply");
    expect(checkpointEngine.shouldPauseHeartbeat(companyId, engineerId)).toBe(true);

    const otherAgentId = db.saveAgent({
      companyId,
      name: "Marketer",
      role: "CMO",
      title: "Chief Marketing Officer",
      status: "idle",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId: db.getTask(taskId).workspaceId ?? null,
      model: null,
      capabilities: "Drive marketing work",
      budgetMonthlyUsd: 180,
    });
    expect(checkpointEngine.shouldPauseHeartbeat(companyId, otherAgentId)).toBe(false);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.body).toContain("@Board review needed");

    dispatchAgentMessage({
      db,
      onHumanMessage: (currentCompanyId, toAgentId, threadId, waitStateId) =>
        threadIntegration.onHumanMessage(currentCompanyId, toAgentId, threadId, waitStateId),
    }, {
      companyId,
      fromAgentId: HUMAN_SENDER_ID,
      fromHumanUser: true,
      channel: "direct",
      toAgentId: engineerId,
      threadId: thread.id,
      body: "Board reviewed this deliverable. Continue.",
    });

    waitStates = db.listThreadWaitStates(companyId).filter((entry) => entry.threadId === thread.id);
    expect(waitStates).toHaveLength(0);
    expect(threadIntegration.hasUnresolvedWaitStatesForAgent(companyId, engineerId)).toBe(false);
    expect(checkpointEngine.shouldPauseHeartbeat(companyId, engineerId)).toBe(false);

    db.close();
  });

  it("resolves approval-linked wait states only when the approval is actually decided", async () => {
    const profileDir = await createTempDir("agentcompany-approval-wait-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, engineerId, taskId } = createScaffold(db);
    const threadIntegration = createThreadIntegration({
      db,
      logger: createNoopLogger(),
    });
    const checkpointEngine = createCheckpointEngine({
      db,
      logger: createNoopLogger(),
      threadIntegration,
      publishDomainChanged: () => {},
      notify: () => {},
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
      throw new Error("Expected a task thread to exist for approval resolution testing.");
    }

    const approvalId = db.requestApproval({
      companyId,
      relatedTaskId: taskId,
      requestedByAgentId: engineerId,
      type: "draft_review",
      payloadSummary: "Review the draft",
      impactSummary: "Board approval is required before this work can continue.",
      payloadJson: "{}",
    });

    threadIntegration.onApprovalCreated(approvalId, companyId, taskId, "draft_review", "Draft review needed");
    let waitStates = db.listThreadWaitStates(companyId).filter((entry) => entry.relatedApprovalId === approvalId);
    expect(waitStates).toHaveLength(1);
    expect(waitStates[0]?.waitingFor).toBe("user_approval");
    expect(checkpointEngine.shouldPauseHeartbeat(companyId, engineerId)).toBe(true);

    dispatchAgentMessage({
      db,
      onHumanMessage: (currentCompanyId, toAgentId, threadId, waitStateId) =>
        threadIntegration.onHumanMessage(currentCompanyId, toAgentId, threadId, waitStateId),
    }, {
      companyId,
      fromAgentId: HUMAN_SENDER_ID,
      fromHumanUser: true,
      channel: "direct",
      toAgentId: engineerId,
      threadId: thread.id,
      body: "Board left a comment but did not decide approval yet.",
    });

    waitStates = db.listThreadWaitStates(companyId).filter((entry) => entry.relatedApprovalId === approvalId);
    expect(waitStates).toHaveLength(1);
    expect(checkpointEngine.shouldPauseHeartbeat(companyId, engineerId)).toBe(true);

    db.decideApproval({
      approvalId,
      state: "approved",
      decisionNote: "Approved by board",
    });
    threadIntegration.onApprovalResolved(approvalId, companyId, "approved");
    waitStates = db.listThreadWaitStates(companyId).filter((entry) => entry.relatedApprovalId === approvalId);
    expect(waitStates).toHaveLength(0);
    expect(checkpointEngine.shouldPauseHeartbeat(companyId, engineerId)).toBe(false);

    db.close();
  });
});
