import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { createThreadIntegration } from "../../src/main/thread-integration";
import { createCheckpointEngine } from "../../src/main/checkpoint-engine";
import { dispatchAgentMessage, HUMAN_SENDER_ID } from "../../src/main/messaging/dispatch";
import { isAppError } from "../../src/main/errors";

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
  db.core.connectors.updateConnectorHealth({
    id: "openai-codex",
    status: "ready",
    authState: "authenticated",
    version: "test",
    lastError: null,
  });

  const companyId = db.core.company.saveCompany({
    name: "Thread Wait Co",
    description: "Tests cofounder wait states and replies",
    status: "active",
    executionMode: "ai_cofounder",
  });
  const workspaceId = db.core.workspaces.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: "/tmp/thread-wait",
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
  const engineerId = db.core.agents.saveAgent({
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
  const taskId = db.core.tasks.saveTask({
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

function expectThreadIntegrationFailure(error: unknown, code: string) {
  expect(isAppError(error)).toBe(true);
  if (isAppError(error)) {
    expect(error.kind).toBe("upstream");
    expect(error.code).toBe(code);
  }
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

    const thread = db.core.threads.listThreads({
      companyId,
      type: "task",
      relatedEntityType: "task",
      relatedEntityId: taskId,
      limit: 1,
    })[0];

    if (!thread) {
      throw new Error("Expected a task thread to exist for the completed run.");
    }

    let waitStates = db.core.threads.listThreadWaitStates(companyId).filter((entry) => entry.threadId === thread.id);
    expect(waitStates).toHaveLength(1);
    expect(waitStates[0]?.waitingFor).toBe("user_reply");
    expect(checkpointEngine.shouldPauseHeartbeat(companyId, engineerId)).toBe(true);

    const otherAgentId = db.core.agents.saveAgent({
      companyId,
      name: "Marketer",
      role: "CMO",
      title: "Chief Marketing Officer",
      status: "idle",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId: db.core.entity.getTask(taskId).workspaceId ?? null,
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

    waitStates = db.core.threads.listThreadWaitStates(companyId).filter((entry) => entry.threadId === thread.id);
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
    const thread = db.core.threads.listThreads({
      companyId,
      type: "task",
      relatedEntityType: "task",
      relatedEntityId: taskId,
      limit: 1,
    })[0];

    if (!thread) {
      throw new Error("Expected a task thread to exist for approval resolution testing.");
    }

    const approvalId = db.core.approvals.requestApproval({
      companyId,
      relatedTaskId: taskId,
      requestedByAgentId: engineerId,
      type: "draft_review",
      payloadSummary: "Review the draft",
      impactSummary: "Board approval is required before this work can continue.",
      payloadJson: "{}",
    });

    threadIntegration.onApprovalCreated(approvalId, companyId, taskId, "draft_review", "Draft review needed");
    let waitStates = db.core.threads.listThreadWaitStates(companyId).filter((entry) => entry.relatedApprovalId === approvalId);
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

    waitStates = db.core.threads.listThreadWaitStates(companyId).filter((entry) => entry.relatedApprovalId === approvalId);
    expect(waitStates).toHaveLength(1);
    expect(checkpointEngine.shouldPauseHeartbeat(companyId, engineerId)).toBe(true);

    db.core.approvals.decideApproval({
      approvalId,
      state: "approved",
      decisionNote: "Approved by board",
    });
    threadIntegration.onApprovalResolved(approvalId, companyId, "approved");
    waitStates = db.core.threads.listThreadWaitStates(companyId).filter((entry) => entry.relatedApprovalId === approvalId);
    expect(waitStates).toHaveLength(0);
    expect(checkpointEngine.shouldPauseHeartbeat(companyId, engineerId)).toBe(false);

    db.close();
  });

  it("keeps co-founder heartbeat paused when wait-state lookup fails", async () => {
    const profileDir = await createTempDir("agentcompany-wait-query-fail-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, engineerId } = createScaffold(db);
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
    vi.spyOn(db.core.threads, "hasUnresolvedWaitStateForAgent").mockImplementation(() => {
      throw new Error("wait-state query failed");
    });

    expect(checkpointEngine.shouldPauseHeartbeat(companyId, engineerId)).toBe(true);

    db.close();
  });

  it("rolls back approval-created thread writes when wait-state creation fails", async () => {
    const profileDir = await createTempDir("agentcompany-approval-create-fail-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, engineerId, taskId } = createScaffold(db);
    const threadIntegration = createThreadIntegration({
      db,
      logger: createNoopLogger(),
    });
    const approvalId = db.core.approvals.requestApproval({
      companyId,
      relatedTaskId: taskId,
      requestedByAgentId: engineerId,
      type: "draft_review",
      payloadSummary: "Review the draft",
      impactSummary: "Board approval is required before this work can continue.",
      payloadJson: "{}",
    });

    vi.spyOn(db.core.threads, "setThreadWaitState").mockImplementation(() => {
      throw new Error("wait-state write failed");
    });

    let thrown: unknown;
    try {
      threadIntegration.onApprovalCreated(approvalId, companyId, taskId, "draft_review", "Draft review needed");
    } catch (error) {
      thrown = error;
    }

    expectThreadIntegrationFailure(thrown, "thread.integration.onApprovalCreated.failed");
    const taskThreads = db.core.threads.listThreads({
      companyId,
      type: "task",
      relatedEntityType: "task",
      relatedEntityId: taskId,
      limit: 1,
    });
    expect(taskThreads).toHaveLength(0);

    db.close();
  });

  it("rolls back approval resolution when decision event recording fails", async () => {
    const profileDir = await createTempDir("agentcompany-approval-resolve-fail-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, engineerId, taskId } = createScaffold(db);
    const threadIntegration = createThreadIntegration({
      db,
      logger: createNoopLogger(),
    });
    threadIntegration.onTaskCreated(taskId, companyId);
    const approvalId = db.core.approvals.requestApproval({
      companyId,
      relatedTaskId: taskId,
      requestedByAgentId: engineerId,
      type: "draft_review",
      payloadSummary: "Review the draft",
      impactSummary: "Board approval is required before this work can continue.",
      payloadJson: "{}",
    });
    threadIntegration.onApprovalCreated(approvalId, companyId, taskId, "draft_review", "Draft review needed");
    const waitStateId = db.core.threads.listThreadWaitStates(companyId)
      .find((entry) => entry.relatedApprovalId === approvalId)?.id;
    expect(waitStateId).toBeTruthy();

    const addThreadEvent = db.core.threads.addThreadEvent.bind(db.core.threads);
    vi.spyOn(db.core.threads, "addThreadEvent").mockImplementation((input) => {
      if (input.eventType === "approval_decision") {
        throw new Error("decision event write failed");
      }
      return addThreadEvent(input);
    });

    let thrown: unknown;
    try {
      threadIntegration.onApprovalResolved(approvalId, companyId, "approved");
    } catch (error) {
      thrown = error;
    }

    expectThreadIntegrationFailure(thrown, "thread.integration.onApprovalResolved.failed");
    const unresolved = db.core.threads.listThreadWaitStates(companyId)
      .filter((entry) => entry.relatedApprovalId === approvalId);
    expect(unresolved.map((entry) => entry.id)).toEqual([waitStateId]);

    db.close();
  });

  it("rolls back human-message wait-state resolution when one resolution fails", async () => {
    const profileDir = await createTempDir("agentcompany-human-message-fail-");
    const db = new AppDatabase(profileDir);
    db.init();

    const { companyId, taskId } = createScaffold(db);
    const threadIntegration = createThreadIntegration({
      db,
      logger: createNoopLogger(),
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
      throw new Error("Expected task thread for human-message failure testing.");
    }

    const first = db.core.threads.setThreadWaitState({
      threadId: thread.id,
      companyId,
      waitingFor: "user_reply",
      relatedApprovalId: null,
      reason: "First reply needed",
    });
    const second = db.core.threads.setThreadWaitState({
      threadId: thread.id,
      companyId,
      waitingFor: "user_review",
      relatedApprovalId: null,
      reason: "Second review needed",
    });

    const resolveThreadWaitState = db.core.threads.resolveThreadWaitState.bind(db.core.threads);
    let resolutionCount = 0;
    vi.spyOn(db.core.threads, "resolveThreadWaitState").mockImplementation((waitStateId, currentCompanyId) => {
      resolutionCount += 1;
      if (resolutionCount === 2) {
        throw new Error("wait-state resolve failed");
      }
      resolveThreadWaitState(waitStateId, currentCompanyId);
    });

    let thrown: unknown;
    try {
      threadIntegration.onHumanMessage(companyId, null, thread.id, null);
    } catch (error) {
      thrown = error;
    }

    expectThreadIntegrationFailure(thrown, "thread.integration.onHumanMessage.failed");
    const unresolvedIds = db.core.threads.listThreadWaitStates(companyId)
      .filter((entry) => entry.threadId === thread.id)
      .map((entry) => entry.id)
      .sort();
    expect(unresolvedIds).toEqual([first.id, second.id].sort());

    db.close();
  });
});
