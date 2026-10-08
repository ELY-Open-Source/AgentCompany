import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";
import { TaskMutations } from "../../src/main/services/task-mutations";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";

function setup() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-review-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let ceoId = "";
  let devId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    ceoId = organization.createAgent({ orgId, name: "Cleo", role: "CEO", department: "Executive", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null, roleLevel: "c_suite" });
    devId = organization.createAgent({ orgId, name: "Dev", role: "Engineer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: ceoId });
  });
  const task = (assigneeAgentId: string, title: string) => organization.createTask({
    orgId, title, description: "Build the login page.", status: TASK_STATUS.IN_PROGRESS, assigneeAgentId,
    risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.HIGH, requiresFilesystem: false,
  });
  const ctx = (agentId: string): AgentToolContext => ({ orgId, agent: { id: agentId, modelProviderId: null, modelId: null }, taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null });
  const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
  const reviews = (taskId: string) => connection.db.prepare("select id, title, assignee_agent_id, status, origin, priority, description from tasks where review_of_task_id = ?").all(taskId) as Array<Record<string, string>>;
  return { connection, organization, orgId, ceoId, devId, task, ctx, deps, reviews };
}

describe("task review", () => {
  test("moving work to review hands a review task to the assignee's manager; the verdict closes it", () => {
    const h = setup();
    const taskId = h.task(h.devId, "Login page");
    expect(dispatchAgentTool(h.deps, h.ctx(h.devId), { id: "c1", name: "update_task_status", arguments: { task_id: taskId, status: "review", evidence: "Login page in file_id=fil_1" } }))
      .toBe(`Task ${taskId} moved to review. Cleo will review it.`);
    const [review] = h.reviews(taskId);
    expect(review).toMatchObject({ title: "Review: Login page", assignee_agent_id: h.ceoId, status: "backlog", origin: "task_review", priority: "high" });
    expect(review.description).toContain(`update_task_status(task_id="${taskId}", status="done", evidence="what you checked")`);
    expect(review.description).toContain(`update_task_status(task_id="${taskId}", status="in_progress")`);

    // Moving to review again while one is open does not duplicate it.
    h.organization.updateTaskStatus(h.orgId, taskId, TASK_STATUS.REVIEW);
    expect(h.reviews(taskId)).toHaveLength(1);

    h.organization.updateTaskStatus(h.orgId, taskId, TASK_STATUS.DONE);
    expect(h.reviews(taskId).map((row) => row.status)).toEqual(["done"]);
    h.connection.close();
  });

  test("sending work back closes the review; work without a manager goes to the operator", () => {
    const h = setup();
    const taskId = h.task(h.devId, "Login page");
    h.organization.updateTaskStatus(h.orgId, taskId, TASK_STATUS.REVIEW);
    h.organization.updateTaskStatus(h.orgId, taskId, TASK_STATUS.IN_PROGRESS);
    expect(h.reviews(taskId).map((row) => row.status)).toEqual(["done"]);

    const ceoTask = h.task(h.ceoId, "Company plan");
    expect(dispatchAgentTool(h.deps, h.ctx(h.ceoId), { id: "c2", name: "update_task_status", arguments: { task_id: ceoTask, status: "review", evidence: "Plan in the plan document" } }))
      .toBe(`Task ${ceoTask} moved to review. It has no manager to review it, so it waits for the operator on the Work board.`);
    expect(h.reviews(ceoTask)).toEqual([]);
    h.connection.close();
  });

  test("a failed review hand-off leaves the task where it was; deleting reviewed work closes its review", () => {
    const h = setup();
    const taskId = h.task(h.devId, "Login page");
    const failing = new TaskMutations(h.connection.db, () => { throw new Error("review task could not be created"); });
    expect(() => failing.updateStatus(h.orgId, taskId, TASK_STATUS.REVIEW)).toThrow("review task could not be created");
    expect(h.connection.db.prepare("select status from tasks where id = ?").get(taskId)).toEqual({ status: "in_progress" });

    h.organization.updateTaskStatus(h.orgId, taskId, TASK_STATUS.REVIEW);
    const [review] = h.reviews(taskId);
    h.organization.deleteTask({ orgId: h.orgId, taskId });
    expect(h.connection.db.prepare("select status, review_of_task_id from tasks where id = ?").get(review.id)).toEqual({ status: "done", review_of_task_id: null });
    h.connection.close();
  });
});
