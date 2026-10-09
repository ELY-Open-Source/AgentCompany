import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { deleteWorkspace, setPrimaryWorkspace, updateWorkspace } from "../../src/main/services/workspace-admin";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";

describe("managing a workspace after adding it", () => {
  test("can be renamed, pointed at a moved folder, relinked, made primary, and removed once nothing open uses it", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-workspace-admin-${randomUUID()}.db`));
    const db = connection.db;
    const organization = new OrganizationService(db);
    const folder = (name: string) => {
      const path = join(tmpdir(), `ac-ws-${name}-${randomUUID()}`);
      mkdirSync(path, { recursive: true });
      return path;
    };
    let orgId = "";
    let wsA = "";
    let wsB = "";
    let projectId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
      projectId = organization.createProject({ orgId, goalId: null, name: "App", description: "d", leadAgentId: null });
      wsA = organization.createWorkspace({ orgId, name: "A", localPath: folder("a"), projectId: null });
      wsB = organization.createWorkspace({ orgId, name: "B", localPath: folder("b"), projectId: null });
    });
    // A run queued for the old folder must not run against the new one.
    db.prepare("insert into task_runs(id, org_id, task_id, trigger, state, workspace_mount_json, created_at) values ('run_q', ?, ?, 'manual', 'queued', ?, ?)")
      .run(orgId, organization.createTask({
        orgId, title: "Queued", description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: null, risk: RISK_LEVEL.LOW,
        projectId: null, goalId: null, workspaceId: wsA, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
      }), JSON.stringify([{ workspaceId: wsA, mode: "read_only" }]), new Date().toISOString());
    const moved = folder("moved");
    updateWorkspace(db, { orgId, workspaceId: wsA, name: "Main repo", localPath: moved, projectId });
    expect(db.prepare("select name, local_path, project_id from workspaces where id = ?").get(wsA)).toEqual({ name: "Main repo", local_path: moved, project_id: projectId });
    expect(db.prepare("select state from task_runs where id = 'run_q'").get()).toEqual({ state: "superseded" });
    expect(() => updateWorkspace(db, { orgId, workspaceId: wsA, name: "Main repo", localPath: join(tmpdir(), "ac-missing-folder"), projectId: null }))
      .toThrow("is not a folder on this computer.");
    expect(() => updateWorkspace(db, { orgId, workspaceId: wsA, name: " ", localPath: moved, projectId: null })).toThrow("The workspace needs a name.");

    setPrimaryWorkspace(db, orgId, wsB);
    expect(db.prepare("select id from workspaces where org_id = ? and is_primary = 1").all(orgId)).toEqual([{ id: wsB }]);
    expect(() => deleteWorkspace(db, orgId, wsB)).toThrow("This is the primary workspace; make another one primary first.");

    const taskId = organization.createTask({
      orgId, title: "Build", description: "d", status: TASK_STATUS.IN_PROGRESS, assigneeAgentId: null, risk: RISK_LEVEL.LOW,
      projectId: null, goalId: null, workspaceId: wsA, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
    });
    expect(() => deleteWorkspace(db, orgId, wsA)).toThrow("2 open tasks use this workspace; move them to another workspace first.");
    db.prepare("update tasks set status = 'done' where workspace_id = ?").run(wsA);
    db.prepare("update tasks set status = 'done' where id = ?").run(taskId);
    deleteWorkspace(db, orgId, wsA);
    expect(db.prepare("select count(*) as n from workspaces where id = ?").get(wsA)).toEqual({ n: 0 });
    expect(db.prepare("select workspace_id from tasks where id = ?").get(taskId)).toEqual({ workspace_id: null });
    connection.close();
  });
});
