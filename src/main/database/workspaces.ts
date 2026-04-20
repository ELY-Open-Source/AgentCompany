import type { DatabaseSync } from "node:sqlite";
import type { RunStatus, WorkspaceRecord } from "@shared/types";
import type { ReadAll, Transaction } from "./helpers";
import { ensureId, normalizeOptionalId, nowIso, toBoolean } from "./helpers";

export function buildWorkspaceMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  return {
    saveWorkspace(input: {
      id?: string | null;
      companyId: string;
      name: string;
      localPath: string;
      repoUrl: string;
      repoRef: string;
      projectId?: string | null;
      isPrimary: boolean;
    }) {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      if (input.isPrimary) {
        getDb().prepare("update workspaces set is_primary = 0 where company_id = ?").run(input.companyId);
      }
      const existing = getDb().prepare("select id from workspaces where id = ? and company_id = ?").get(id, input.companyId) as { id: string } | undefined;
      if (existing) {
        getDb()
          .prepare(
            "update workspaces set name = ?, local_path = ?, repo_url = ?, repo_ref = ?, project_id = ?, is_primary = ?, updated_at = ? where id = ? and company_id = ?",
          )
          .run(input.name, input.localPath, input.repoUrl, input.repoRef, normalizeOptionalId(input.projectId), input.isPrimary ? 1 : 0, ts, id, input.companyId);
      } else {
        getDb()
          .prepare(
            "insert into workspaces (id, company_id, name, local_path, repo_url, repo_ref, project_id, state, is_primary, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)",
          )
          .run(id, input.companyId, input.name, input.localPath, input.repoUrl, input.repoRef, normalizeOptionalId(input.projectId), input.isPrimary ? 1 : 0, ts, ts);
      }
      return id;
    },

    getWorkspace(id: string | null | undefined): WorkspaceRecord | null {
      if (!id) return null;
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, name, local_path as localPath, repo_url as repoUrl, repo_ref as repoRef, project_id as projectId, state, is_primary as isPrimary, created_at as createdAt, updated_at as updatedAt from workspaces where id = ?",
        )
        .get(id) as WorkspaceRecord | undefined;
      return row ? { ...row, isPrimary: toBoolean(row.isPrimary) } : null;
    },

    getProjectPrimaryWorkspace(projectId: string | null | undefined, companyId: string): WorkspaceRecord | null {
      if (!projectId) return null;
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, name, local_path as localPath, repo_url as repoUrl, repo_ref as repoRef, project_id as projectId, state, is_primary as isPrimary, created_at as createdAt, updated_at as updatedAt from workspaces where company_id = ? and project_id = ? order by is_primary desc, created_at asc limit 1",
        )
        .get(companyId, projectId) as WorkspaceRecord | undefined;
      return row ? { ...row, isPrimary: toBoolean(row.isPrimary) } : null;
    },

    /**
     * Pick a single workspace per company for *observation only* (no
     * lock claim). Used by the artifact projector to know where on
     * disk a `lockMode='none'` cognitive run might write files. The
     * tie-break order is `is_primary` first, then earliest `created_at`
     * — i.e. the workspace the operator marked as canonical wins, and
     * if no one is marked, the oldest row wins (which historically is
     * the company's default scratch directory).
     *
     * Returns `null` when the company has no workspace at all; the
     * caller treats that as "agent has no observation surface", which
     * is correct — there is genuinely nowhere to look for files.
     */
    getCompanyObservationWorkspace(companyId: string): WorkspaceRecord | null {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, name, local_path as localPath, repo_url as repoUrl, repo_ref as repoRef, project_id as projectId, state, is_primary as isPrimary, created_at as createdAt, updated_at as updatedAt from workspaces where company_id = ? order by is_primary desc, created_at asc limit 1",
        )
        .get(companyId) as WorkspaceRecord | undefined;
      return row ? { ...row, isPrimary: toBoolean(row.isPrimary) } : null;
    },

    listWorkspaceLocalPaths(companyId: string): string[] {
      const rows = getDb()
        .prepare("select local_path as localPath from workspaces where company_id = ? and local_path is not null")
        .all(companyId) as Array<{ localPath: string }>;
      return rows.map((r) => r.localPath).filter(Boolean);
    },

    deleteWorkspace(id: string, companyId: string) {
      transaction(() => {
        getDb().prepare("update agents set workspace_id = null where workspace_id = ? and company_id = ?").run(id, companyId);
        getDb().prepare("update tasks set workspace_id = null where workspace_id = ? and company_id = ?").run(id, companyId);
        getDb().prepare("delete from workspaces where id = ? and company_id = ?").run(id, companyId);
      });
    },

    acquireWorkspaceLock(workspaceId: string, runId: string): boolean {
      const ts = nowIso();
      const result = getDb()
        .prepare(
          `update workspaces
             set lock_holder_run_id = ?, lock_acquired_at = ?, state = 'busy', updated_at = ?
           where id = ?
             and (lock_holder_run_id is null or lock_holder_run_id = ?)`,
        )
        .run(runId, ts, ts, workspaceId, runId);
      return result.changes > 0;
    },

    claimWorkspaceLock(workspaceId: string, runId: string): boolean {
      const holder = getDb()
        .prepare("select lock_holder_run_id as lockHolderRunId from workspaces where id = ?")
        .get(workspaceId) as { lockHolderRunId: string | null } | undefined;
      if (!holder) return false;
      if (!holder.lockHolderRunId || holder.lockHolderRunId === runId) {
        const ts = nowIso();
        const result = getDb()
          .prepare(
            `update workspaces
               set lock_holder_run_id = ?, lock_acquired_at = ?, state = 'busy', updated_at = ?
             where id = ?
               and (lock_holder_run_id is null or lock_holder_run_id = ?)`,
          )
          .run(runId, ts, ts, workspaceId, runId);
        return result.changes > 0;
      }
      const blockingRun = getDb()
        .prepare("select status from runs where id = ?")
        .get(holder.lockHolderRunId) as { status: RunStatus } | undefined;
      if (blockingRun && (blockingRun.status === "queued" || blockingRun.status === "running")) {
        return false;
      }
      const ts = nowIso();
      const result = getDb()
        .prepare(
          `update workspaces
             set lock_holder_run_id = ?, lock_acquired_at = ?, state = 'busy', updated_at = ?
           where id = ? and lock_holder_run_id = ?`,
        )
        .run(runId, ts, ts, workspaceId, holder.lockHolderRunId);
      return result.changes > 0;
    },

    releaseWorkspaceLock(workspaceId: string, runId: string) {
      getDb()
        .prepare(
          `update workspaces
             set lock_holder_run_id = null, lock_acquired_at = null, state = 'ready', updated_at = ?
           where id = ? and lock_holder_run_id = ?`,
        )
        .run(nowIso(), workspaceId, runId);
    },

    releaseAllWorkspaceLocks() {
      getDb()
        .prepare(
          "update workspaces set lock_holder_run_id = null, lock_acquired_at = null, state = 'ready', updated_at = ? where lock_holder_run_id is not null",
        )
        .run(nowIso());
    },

    releaseStaleWorkspaceLocks(): number {
      const result = getDb()
        .prepare(
          `update workspaces
              set lock_holder_run_id = null, lock_acquired_at = null, state = 'ready', updated_at = ?
            where lock_holder_run_id is not null
              and not exists (
                select 1
                  from runs
                 where runs.id = workspaces.lock_holder_run_id
                   and runs.status in ('queued', 'running')
              )`,
        )
        .run(nowIso());
      return Number(result.changes);
    },

    isWorkspaceLocked(workspaceId: string): boolean {
      const row = getDb()
        .prepare("select lock_holder_run_id from workspaces where id = ?")
        .get(workspaceId) as { lock_holder_run_id: string | null } | undefined;
      return Boolean(row?.lock_holder_run_id);
    },
  };
}
