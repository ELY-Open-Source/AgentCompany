import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS, WRITING_MODE } from "../../src/shared/domain";

describe("editing a task", () => {
  test("can correct its project, goal, workspace, access and writing mode like creating it can", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-task-edit-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const ids: Record<string, string> = {};
    connection.transaction(() => {
      ids.org = organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
      ids.goalA = organization.createGoal({ orgId: ids.org, title: "Goal A", description: "d", ownerAgentId: null });
      ids.goalB = organization.createGoal({ orgId: ids.org, title: "Goal B", description: "d", ownerAgentId: null });
      ids.projectA = organization.createProject({ orgId: ids.org, goalId: ids.goalA, name: "Project A", description: "d", leadAgentId: null });
      ids.projectB = organization.createProject({ orgId: ids.org, goalId: ids.goalB, name: "Project B", description: "d", leadAgentId: null });
      for (const name of ["wsA", "wsB"]) {
        const path = join(tmpdir(), `ac-task-edit-${name}-${randomUUID()}`);
        mkdirSync(path, { recursive: true });
        ids[name] = organization.createWorkspace({ orgId: ids.org, name, localPath: path, projectId: null });
      }
      ids.task = organization.createTask({
        orgId: ids.org, title: "Ship", description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: null, risk: RISK_LEVEL.LOW,
        projectId: ids.projectA, goalId: ids.goalA, workspaceId: ids.wsA, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
      });
    });
    const edit = (change: { projectId: string | null; goalId: string | null; workspaceId: string | null }) => connection.transaction(() => organization.updateTask({
      orgId: ids.org, taskId: ids.task, title: "Ship", description: "d", assigneeAgentId: null, risk: RISK_LEVEL.LOW, priority: TASK_PRIORITY.NORMAL,
      parentTaskId: null, requiresFilesystem: true, writingMode: WRITING_MODE.TECHNICAL, ...change,
    }));

    edit({ projectId: ids.projectB, goalId: ids.goalB, workspaceId: ids.wsB });
    expect(connection.db.prepare("select project_id, goal_id, workspace_id, requires_filesystem, writing_mode from tasks where id = ?").get(ids.task))
      .toEqual({ project_id: ids.projectB, goal_id: ids.goalB, workspace_id: ids.wsB, requires_filesystem: 1, writing_mode: "technical" });
    expect(() => edit({ projectId: ids.projectA, goalId: ids.goalB, workspaceId: ids.wsB })).toThrow("Project is linked to a different goal.");
    expect(() => edit({ projectId: null, goalId: null, workspaceId: "wsp_missing" })).toThrow("Workspace was not found.");
    expect(() => edit({ projectId: null, goalId: "gol_missing", workspaceId: null })).toThrow("Goal was not found.");
    connection.close();
  });
});
