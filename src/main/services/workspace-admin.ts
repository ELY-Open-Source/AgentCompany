import { existsSync, statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { UpdateWorkspaceInput } from "../../shared/commands";
import { AuditService } from "./audit-service";
import { closeChatWakeTask } from "./chat-wake-close";

function requireWorkspace(db: DatabaseSync, orgId: string, workspaceId: string): { name: string; local_path: string } {
  const row = db.prepare("select name, local_path from workspaces where id = ? and org_id = ?").get(workspaceId, orgId) as { name: string; local_path: string } | undefined;
  if (!row) throw new Error("Workspace was not found.");
  return row;
}

/** Renames a workspace, points it at its folder (which must exist), or relinks its project; runs queued for the old folder are superseded. */
export function updateWorkspace(db: DatabaseSync, input: UpdateWorkspaceInput): void {
  const before = requireWorkspace(db, input.orgId, input.workspaceId);
  const name = input.name.trim();
  if (!name) throw new Error("The workspace needs a name.");
  const localPath = input.localPath.trim();
  if (!existsSync(localPath) || !statSync(localPath).isDirectory()) throw new Error(`"${localPath}" is not a folder on this computer.`);
  if (input.projectId && !db.prepare("select 1 from projects where id = ? and org_id = ?").get(input.projectId, input.orgId)) throw new Error("Project was not found.");
  db.prepare("update workspaces set name = ?, local_path = ?, project_id = ?, updated_at = ? where id = ? and org_id = ?")
    .run(name, localPath, input.projectId, new Date().toISOString(), input.workspaceId, input.orgId);
  if (localPath !== before.local_path) supersedeQueuedRuns(db, input.orgId, input.workspaceId);
  new AuditService(db).record({ orgId: input.orgId, entityType: "workspace", entityId: input.workspaceId, actorType: "employee", actorId: null, action: "updated", payload: { name, localPath, projectId: input.projectId } });
}

/** Makes one workspace the company's primary one, where new goals' work starts; the others stop being primary. */
export function setPrimaryWorkspace(db: DatabaseSync, orgId: string, workspaceId: string): void {
  requireWorkspace(db, orgId, workspaceId);
  db.prepare("update workspaces set is_primary = case when id = ? then 1 else 0 end, updated_at = ? where org_id = ?").run(workspaceId, new Date().toISOString(), orgId);
  new AuditService(db).record({ orgId, entityType: "workspace", entityId: workspaceId, actorType: "employee", actorId: null, action: "made_primary", payload: {} });
}

/** Removes a workspace nothing open uses; finished tasks keep their history without the link. */
export function deleteWorkspace(db: DatabaseSync, orgId: string, workspaceId: string): void {
  const workspace = requireWorkspace(db, orgId, workspaceId);
  const count = (sql: string) => (db.prepare(sql).get(workspaceId, orgId) as { n: number }).n;
  // New goals start in the primary workspace, so it cannot leave while another could take its place.
  const primary = count("select count(*) as n from workspaces where id = ? and org_id = ? and is_primary = 1") > 0;
  const others = count("select count(*) as n from workspaces where id <> ? and org_id = ?");
  if (primary && others > 0) throw new Error("This is the primary workspace; make another one primary first.");
  const openTasks = count("select count(*) as n from tasks where workspace_id = ? and org_id = ? and status <> 'done'");
  if (openTasks > 0) throw new Error(`${openTasks} open task${openTasks === 1 ? " uses" : "s use"} this workspace; move ${openTasks === 1 ? "it" : "them"} to another workspace first.`);
  const agents = count("select count(*) as n from agents where workspace_id = ? and org_id = ?");
  if (agents > 0) throw new Error(`${agents} agent${agents === 1 ? " works" : "s work"} in this workspace; give ${agents === 1 ? "it" : "them"} another workspace first.`);
  db.prepare("update tasks set workspace_id = null where workspace_id = ? and org_id = ?").run(workspaceId, orgId);
  db.prepare("delete from workspaces where id = ? and org_id = ?").run(workspaceId, orgId);
  console.info(`[workspaces] removed ${workspace.name} (${workspaceId})`);
  new AuditService(db).record({ orgId, entityType: "workspace", entityId: workspaceId, actorType: "employee", actorId: null, action: "deleted", payload: { name: workspace.name } });
}

/** A queued run recorded the old folder as its mount; it would run against the new one, so it is superseded instead (no retry budget spent). */
function supersedeQueuedRuns(db: DatabaseSync, orgId: string, workspaceId: string): void {
  const queued = db.prepare(`
    select r.id from task_runs r
    where r.org_id = ? and r.state = 'queued'
      and exists (select 1 from json_each(r.workspace_mount_json) m where json_extract(m.value, '$.workspaceId') = ?)
  `).all(orgId, workspaceId) as Array<{ id: string }>;
  for (const run of queued) {
    db.prepare("update task_runs set state = 'superseded', completed_at = ?, error_message = ? where id = ?")
      .run(new Date().toISOString(), "Superseded: the workspace folder changed after this run was queued.", run.id);
    closeChatWakeTask(db, orgId, run.id);
    console.info(`[workspaces] run ${run.id} superseded: its workspace folder changed`);
  }
}
