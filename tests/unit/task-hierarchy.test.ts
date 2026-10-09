import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentLinks } from "../helpers/task-links";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";

describe("task hierarchy", () => {
  test("a task cannot become its own parent or the child of its own descendant", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-tree-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    const ids: Record<string, string> = {};
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      for (const title of ["A", "B", "C"]) {
        ids[title] = organization.createTask({
          orgId, title, description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: null,
          risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
        });
      }
    });
    const reparent = (title: string, parent: string | null) => organization.updateTask({
      orgId, taskId: ids[title], title, description: "d", assigneeAgentId: null, risk: RISK_LEVEL.LOW, priority: TASK_PRIORITY.NORMAL, parentTaskId: parent,
      ...currentLinks(connection.db, ids[title]),
    });
    reparent("B", ids.A);
    reparent("C", ids.B);
    expect(() => reparent("A", ids.A)).toThrow('"A" cannot be its own parent.');
    expect(() => reparent("A", ids.C)).toThrow('"A" cannot sit under "C": "C" is already beneath "A".');
    expect(connection.db.prepare("select parent_task_id from tasks where id = ?").get(ids.A)).toEqual({ parent_task_id: null });
    reparent("C", ids.A);
    reparent("C", null);
    connection.close();
  });
});
