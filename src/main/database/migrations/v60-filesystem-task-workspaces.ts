import type { DatabaseSync } from "node:sqlite";
import { nowIso, tableExists } from "./types";

export const FILESYSTEM_TASK_WORKSPACES_SCHEMA_VERSION = 60;
export const FILESYSTEM_TASK_WORKSPACES_SCHEMA_NAME = "filesystem_task_workspaces";

const ACTIVE_TASK_STATUSES = "'backlog', 'todo', 'in_progress', 'blocked'";

export function migrateFilesystemTaskWorkspacesV60(db: DatabaseSync): void {
  backfillProjectWorkspaces(db);
  backfillAssigneeWorkspaces(db);
  backfillSingleCompanyWorkspaces(db);
  db
    .prepare("insert or replace into schema_migrations (version, name, applied_at) values (?, ?, ?)")
    .run(FILESYSTEM_TASK_WORKSPACES_SCHEMA_VERSION, FILESYSTEM_TASK_WORKSPACES_SCHEMA_NAME, nowIso());
  assertFilesystemTaskWorkspacesV60(db);
}

export function assertFilesystemTaskWorkspacesV60(db: DatabaseSync): void {
  if (!tableExists(db, "tasks") || !tableExists(db, "workspaces")) {
    throw new Error("Schema v60 drift: tasks/workspaces tables are missing.");
  }
  const unresolved = db
    .prepare(
      `select count(*) as count
         from tasks t
        where t.requires_filesystem = 1
          and t.workspace_id is null
          and t.status in (${ACTIVE_TASK_STATUSES})
          and (
            select count(*)
              from workspaces w
             where w.company_id = t.company_id
          ) = 1`,
    )
    .get() as { count: number } | undefined;
  if ((unresolved?.count ?? 0) > 0) {
    throw new Error("Schema v60 drift: single-workspace companies still have unresolved filesystem tasks.");
  }
}

function backfillProjectWorkspaces(db: DatabaseSync): void {
  if (!hasRequiredTables(db)) return;
  db
    .prepare(
      `update tasks
          set workspace_id = (
                select w.id
                  from workspaces w
                 where w.company_id = tasks.company_id
                   and w.project_id = tasks.project_id
                 order by w.is_primary desc, w.created_at asc
                 limit 1
              ),
              updated_at = ?
        where requires_filesystem = 1
          and workspace_id is null
          and status in (${ACTIVE_TASK_STATUSES})
          and project_id is not null
          and exists (
                select 1
                  from workspaces w
                 where w.company_id = tasks.company_id
                   and w.project_id = tasks.project_id
              )`,
    )
    .run(nowIso());
}

function backfillAssigneeWorkspaces(db: DatabaseSync): void {
  if (!hasRequiredTables(db) || !tableExists(db, "agents")) return;
  db
    .prepare(
      `update tasks
          set workspace_id = (
                select a.workspace_id
                  from agents a
                  join workspaces w
                    on w.id = a.workspace_id
                   and w.company_id = a.company_id
                 where a.id = tasks.assignee_agent_id
                   and a.company_id = tasks.company_id
                 limit 1
              ),
              updated_at = ?
        where requires_filesystem = 1
          and workspace_id is null
          and status in (${ACTIVE_TASK_STATUSES})
          and assignee_agent_id is not null
          and exists (
                select 1
                  from agents a
                  join workspaces w
                    on w.id = a.workspace_id
                   and w.company_id = a.company_id
                 where a.id = tasks.assignee_agent_id
                   and a.company_id = tasks.company_id
              )`,
    )
    .run(nowIso());
}

function backfillSingleCompanyWorkspaces(db: DatabaseSync): void {
  if (!hasRequiredTables(db)) return;
  db
    .prepare(
      `update tasks
          set workspace_id = (
                select w.id
                  from workspaces w
                 where w.company_id = tasks.company_id
                 order by w.is_primary desc, w.created_at asc
                 limit 1
              ),
              updated_at = ?
        where requires_filesystem = 1
          and workspace_id is null
          and status in (${ACTIVE_TASK_STATUSES})
          and (
                select count(*)
                  from workspaces w
                 where w.company_id = tasks.company_id
              ) = 1`,
    )
    .run(nowIso());
}

function hasRequiredTables(db: DatabaseSync): boolean {
  return tableExists(db, "tasks") && tableExists(db, "workspaces");
}
