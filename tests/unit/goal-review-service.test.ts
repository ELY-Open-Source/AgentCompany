import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { spawnGoalReviews } from "../../src/main/services/goal-review-service";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";

interface Harness {
  connection: DatabaseConnection;
  organization: OrganizationService;
  orgId: string;
  ceoId: string;
  goalId: string;
  kickoffId: string;
}

function createHarness(): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-goal-review-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let ceoId = "";
  let goalId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "LoopCorp", employeeName: "Yang", mission: "m", goal: "g" });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    ceoId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
    });
    goalId = organization.createGoal({ orgId, title: "Ship the platform", description: "Deliver it for real.", ownerAgentId: ceoId });
  });
  const kickoffId = (connection.db.prepare("select id from tasks where goal_id = ?").get(goalId) as { id: string }).id;
  return { connection, organization, orgId, ceoId, goalId, kickoffId };
}

function setTaskStatus(h: Harness, taskId: string, status: string, updatedAt?: string): void {
  h.connection.db.prepare("update tasks set status = ?, updated_at = ? where id = ?")
    .run(status, updatedAt ?? new Date().toISOString(), taskId);
}

function addDoneTask(h: Harness, title: string, origin: string | null, updatedAt: string): string {
  let taskId = "";
  h.connection.transaction(() => {
    taskId = h.organization.createTask({
      orgId: h.orgId, title, description: "d", status: TASK_STATUS.DONE, assigneeAgentId: h.ceoId,
      risk: RISK_LEVEL.LOW, projectId: null, goalId: h.goalId, workspaceId: null,
      priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
      ...(origin ? { origin: origin as "chat_wake" | "goal_review" } : {}),
    });
  });
  h.connection.db.prepare("update tasks set updated_at = ? where id = ?").run(updatedAt, taskId);
  return taskId;
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function reviews(h: Harness): Array<{ id: string; status: string }> {
  return h.connection.db.prepare("select id, status from tasks where goal_id = ? and origin = 'goal_review' order by created_at")
    .all(h.goalId) as Array<{ id: string; status: string }>;
}

describe("goal review service", () => {
  test("spawns one review when the board drains, and never duplicates while it is open", () => {
    const h = createHarness();
    // Open kickoff blocks the checkpoint.
    expect(h.connection.transaction(() => spawnGoalReviews(h.connection.db, h.organization))).toEqual([]);

    setTaskStatus(h, h.kickoffId, TASK_STATUS.DONE);
    const first = h.connection.transaction(() => spawnGoalReviews(h.connection.db, h.organization));
    expect(first).toHaveLength(1);
    const review = h.connection.db.prepare("select title, origin, status, assignee_agent_id from tasks where id = ?")
      .get(first[0]) as { title: string; origin: string; status: string; assignee_agent_id: string };
    expect(review).toMatchObject({ origin: "goal_review", status: "backlog", assignee_agent_id: h.ceoId });
    expect(review.title).toContain("Goal review:");

    // The open review itself blocks a duplicate.
    expect(h.connection.transaction(() => spawnGoalReviews(h.connection.db, h.organization))).toEqual([]);
    h.connection.close();
  });

  test("a review that ends without new work does not respawn; real progress does", () => {
    const h = createHarness();
    setTaskStatus(h, h.kickoffId, TASK_STATUS.DONE);
    const [reviewId] = h.connection.transaction(() => spawnGoalReviews(h.connection.db, h.organization));

    // CEO closes the review without creating tasks or completing the goal: silence, not a loop.
    setTaskStatus(h, reviewId, TASK_STATUS.DONE, hoursFromNow(1));
    expect(h.connection.transaction(() => spawnGoalReviews(h.connection.db, h.organization))).toEqual([]);

    // Chatter never counts as progress.
    addDoneTask(h, "Reply to CEO", "chat_wake", hoursFromNow(2));
    expect(h.connection.transaction(() => spawnGoalReviews(h.connection.db, h.organization))).toEqual([]);

    // A real completed task after the last review re-arms the checkpoint.
    addDoneTask(h, "Implement tenant module", null, hoursFromNow(3));
    expect(h.connection.transaction(() => spawnGoalReviews(h.connection.db, h.organization))).toHaveLength(1);
    expect(reviews(h)).toHaveLength(2);
    h.connection.close();
  });

  test("achieved goals never spawn reviews", () => {
    const h = createHarness();
    setTaskStatus(h, h.kickoffId, TASK_STATUS.DONE);
    h.connection.db.prepare("update goals set status = 'achieved' where id = ?").run(h.goalId);
    expect(h.connection.transaction(() => spawnGoalReviews(h.connection.db, h.organization))).toEqual([]);
    h.connection.close();
  });
});
