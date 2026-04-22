import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { AppDatabase } from "../../src/main/database";

function seedCompany(db: AppDatabase) {
  const companyId = db.company.saveCompany({
    name: "Review Co",
    description: "Task update transaction tests",
    status: "active",
  });
  db.connectorsCrud.saveConnector({
    id: "openai-codex",
    model: "gpt-5",
    envBindingText: "",
    notes: "fixture",
  });
  const managerId = db.agents.saveAgent({
    companyId,
    name: "Manager",
    role: "VP Engineering",
    title: "Manager",
    department: "engineering",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId: null,
    model: null,
    capabilities: "Review",
    budgetMonthlyUsd: 100,
  });
  const workerId = db.agents.saveAgent({
    companyId,
    name: "Worker",
    role: "Engineer",
    title: "Engineer",
    department: "engineering",
    status: "active",
    reportsTo: managerId,
    connectorId: "openai-codex",
    workspaceId: null,
    model: null,
    capabilities: "Build",
    budgetMonthlyUsd: 100,
  });
  return { companyId, managerId, workerId };
}

function createReviewTask(db: AppDatabase, input: { companyId: string; assigneeAgentId: string }) {
  const taskId = db.tasks.saveTask({
    companyId: input.companyId,
    title: "Ship review packet",
    description: "Prepare a review packet.",
    assigneeAgentId: input.assigneeAgentId,
    priority: "high",
    status: "todo",
    requiresFilesystem: false,
  });
  db.tasks.setTaskRequiresUserReview(taskId, true);
  return taskId;
}

describe("updateTaskWithReviewSideEffects", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "task-update-transaction-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rolls back review approval, flag clear, and comments when the status guard rejects", () => {
    const { companyId, managerId } = seedCompany(db);
    const taskId = createReviewTask(db, { companyId, assigneeAgentId: managerId });

    expect(() =>
      db.tasks.updateTaskWithReviewSideEffects({
        taskId,
        companyId,
        actorAgentId: managerId,
        actorName: "Manager",
        task: {
          title: "Ship review packet",
          description: "Prepare a review packet.",
          status: "done",
          priority: "high",
          projectId: null,
          goalId: null,
          parentId: null,
          assigneeAgentId: managerId,
          workspaceId: null,
          requiresFilesystem: false,
        },
        comment: "Ready for board review.",
        reviewRequest: {
          reviewerAgentName: "Manager",
          documents: [],
        },
        activity: {
          action: "task.status_changed",
          detail: "Ready for board review.",
        },
      }),
    ).toThrow(/cannot enter in_review/);

    const task = db.entityCrud.getTask(taskId);
    expect(task.status).toBe("todo");
    expect(task.requiresUserReview).toBe(true);
    expect(db.snap.listSnapshot().approvals).toHaveLength(0);
    expect(db.activityMod.listComments(taskId)).toHaveLength(0);
  });

  it("commits review approval, flag clear, status, main row, comment, and activity together", () => {
    const { companyId, managerId, workerId } = seedCompany(db);
    const taskId = createReviewTask(db, { companyId, assigneeAgentId: workerId });

    const result = db.tasks.updateTaskWithReviewSideEffects({
      taskId,
      companyId,
      actorAgentId: managerId,
      actorName: "Manager",
      task: {
        title: "Ship review packet v2",
        description: "Prepare a review packet with final notes.",
        status: "done",
        priority: "critical",
        projectId: null,
        goalId: null,
        parentId: null,
        assigneeAgentId: workerId,
        workspaceId: null,
        requiresFilesystem: false,
      },
      comment: "Ready for board review.",
      reviewRequest: {
        reviewerAgentName: "Manager",
        documents: [{ id: "doc-1", title: "Review Packet" }],
      },
      activity: {
        action: "task.status_changed",
        detail: "Ready for board review.",
      },
    });

    const task = db.entityCrud.getTask(taskId);
    const approvals = db.snap.listSnapshot().approvals;
    expect(result.previousStatus).toBe("todo");
    expect(result.newStatus).toBe("in_review");
    expect(result.reviewRequested).toBe(true);
    expect(task.status).toBe("in_review");
    expect(task.title).toBe("Ship review packet v2");
    expect(task.priority).toBe("critical");
    expect(task.requiresUserReview).toBe(false);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.type).toBe("deliverable_review");
    expect(db.activityMod.listComments(taskId).map((comment) => comment.body)).toEqual([
      "Deliverable submitted for board review.",
      "Ready for board review.",
    ]);
  });
});
