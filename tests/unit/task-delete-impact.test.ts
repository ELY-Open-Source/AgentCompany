import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { DocumentService } from "../../src/main/services/document-service";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";

describe("deleting a task", () => {
  test("says beforehand what goes with it, what stays, and what stops it", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-delete-impact-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const ids: Record<string, string> = {};
    const task = (title: string) => organization.createTask({
      orgId: ids.org, title, description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: null, risk: RISK_LEVEL.LOW,
      projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
    });
    connection.transaction(() => {
      ids.org = organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
      ids.agent = organization.createAgent({ orgId: ids.org, name: "Ada", role: "Engineer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null });
      ids.task = task("Parent");
      ids.sub = task("Child");
      connection.db.prepare("update tasks set parent_task_id = ? where id = ?").run(ids.task, ids.sub);
      new DocumentService(connection.db).create({ orgId: ids.org, title: "Spec", docType: "spec", content: "c", authorAgentId: null, reviewerAgentId: null, projectId: null, goalId: null, taskId: ids.task });
      for (const state of ["completed", "failed"]) {
        connection.db.prepare("insert into task_runs(id, org_id, task_id, agent_id, trigger, state, created_at) values (?, ?, ?, ?, 'manual', ?, ?)")
          .run(`run_${state}`, ids.org, ids.task, ids.agent, state, new Date().toISOString());
      }
    });
    expect(organization.taskDeleteImpact(ids.org, ids.task)).toEqual({ runs: 2, running: 0, subtasks: 1, documents: 1, openReviews: 0, pendingApprovals: 0 });
    connection.db.prepare("update task_runs set state = 'running' where id = 'run_failed'").run();
    expect(organization.taskDeleteImpact(ids.org, ids.task).running).toBe(1);
    expect(() => organization.taskDeleteImpact(ids.org, "tsk_missing")).toThrow("Task was not found.");
    connection.close();
  });
});
