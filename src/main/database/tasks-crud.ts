import type { DatabaseSync } from "node:sqlite";
import {
  type ReadAll,
  type Transaction,
  ensureId,
  normalizeOptionalId,
  nowIso,
} from "./helpers";

/**
 * Row shape returned by listTasksByStatuses — used by the
 * GET /api/companies/:companyId/issues route. Mirrors the historical
 * inline-SQL projection (no taskType column) so the HTTP response shape
 * stays stable for agent CLI clients.
 */
export type TaskListByStatusesRow = {
  id: string;
  companyId: string;
  projectId: string | null;
  goalId: string | null;
  parentId: string | null;
  title: string;
  description: string;
  assigneeAgentId: string | null;
  workspaceId: string | null;
  status: string;
  priority: string;
  activeRunId: string | null;
  costUsd: number | null;
  requiresUserReview: boolean;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function buildTaskCrudMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  _deps: {
    addComment: (input: { companyId: string; taskId: string; authorAgentId: string | null; authorName: string; body: string }) => void;
    addActivity: (input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) => void;
  },
) {
  return {
    saveTask(input: {
      id?: string | null;
      companyId: string;
      projectId?: string | null;
      goalId?: string | null;
      parentId?: string | null;
      title: string;
      description: string;
      assigneeAgentId?: string | null;
      workspaceId?: string | null;
      priority: string;
      status: string;
      /**
       * Per-task filesystem lock policy (v52+). Production callers
       * pass this explicitly. Direct DB fixtures may omit it: inserts
       * use the SQL default 0 and updates preserve the stored value.
       */
      requiresFilesystem?: boolean;
    }): string {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      const assigneeAgentId = normalizeOptionalId(input.assigneeAgentId);
      if (input.status === "in_progress" && !assigneeAgentId) {
        throw new Error("Tasks in progress require an assignee.");
      }
      const existing = getDb()
        .prepare("select id from tasks where id = ? and company_id = ?")
        .get(id, input.companyId) as { id: string } | undefined;
      if (existing) {
        if (input.requiresFilesystem === undefined) {
          getDb()
            .prepare(
              // eslint-disable-next-line no-restricted-syntax -- B2 Phase 1 grandfathered: saveTask upsert path writes the full row (including status) as a single atomic UPDATE. The status→phase trigger keeps the shadow phase column in sync; no lease is ever held by saveTask callers (lease writes live behind checkoutTask).
              "update tasks set project_id = ?, goal_id = ?, parent_id = ?, title = ?, description = ?, assignee_agent_id = ?, workspace_id = ?, priority = ?, status = ?, updated_at = ? where id = ? and company_id = ?",
            )
            .run(
              normalizeOptionalId(input.projectId),
              normalizeOptionalId(input.goalId),
              normalizeOptionalId(input.parentId),
              input.title,
              input.description,
              assigneeAgentId,
              normalizeOptionalId(input.workspaceId),
              input.priority,
              input.status,
              ts,
              id,
              input.companyId,
            );
        } else {
          getDb()
            .prepare(
              // eslint-disable-next-line no-restricted-syntax -- B2 Phase 1 grandfathered: saveTask upsert path writes the full row (including status) as a single atomic UPDATE. The status→phase trigger keeps the shadow phase column in sync; no lease is ever held by saveTask callers (lease writes live behind checkoutTask).
              "update tasks set project_id = ?, goal_id = ?, parent_id = ?, title = ?, description = ?, assignee_agent_id = ?, workspace_id = ?, priority = ?, status = ?, requires_filesystem = ?, updated_at = ? where id = ? and company_id = ?",
            )
            .run(
              normalizeOptionalId(input.projectId),
              normalizeOptionalId(input.goalId),
              normalizeOptionalId(input.parentId),
              input.title,
              input.description,
              assigneeAgentId,
              normalizeOptionalId(input.workspaceId),
              input.priority,
              input.status,
              input.requiresFilesystem ? 1 : 0,
              ts,
              id,
              input.companyId,
            );
        }
      } else {
        getDb()
          .prepare(
            "insert into tasks (id, company_id, project_id, goal_id, parent_id, title, description, assignee_agent_id, workspace_id, status, priority, requires_filesystem, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            id,
            input.companyId,
            normalizeOptionalId(input.projectId),
            normalizeOptionalId(input.goalId),
            normalizeOptionalId(input.parentId),
            input.title,
            input.description,
            assigneeAgentId,
            normalizeOptionalId(input.workspaceId),
            input.status,
            input.priority,
            input.requiresFilesystem ? 1 : 0,
            ts,
            ts,
          );
      }
      return id;
    },

    deleteTask(id: string, companyId: string): void {
      transaction(() => {
        const activeTaskRuns = getDb()
          .prepare(
            "select id, task_id as taskId, workspace_id as workspaceId from runs where task_id = ? and company_id = ? and status in ('queued', 'running')",
          )
          .all(id, companyId) as Array<{
          id: string;
          taskId: string;
          workspaceId: string | null;
        }>;
        for (const run of activeTaskRuns) {
          const ts = nowIso();
          getDb()
            .prepare(
              "update runs set status = 'cancelled', summary = ?, error_message = null, exit_code = null, signal = null, model = null, session_display_id = null, cost_usd = null, unattributed_cost = 1, finished_at = ?, updated_at = ? where id = ?",
            )
            .run("Task deleted.", ts, ts, run.id);
          getDb()
            .prepare("update tasks set active_run_id = null, updated_at = ? where id = ?")
            .run(ts, run.taskId);
          getDb()
            .prepare(
              "UPDATE tasks SET checkout_run_id = NULL, execution_locked_at = NULL, updated_at = ? WHERE id = ? AND checkout_run_id = ?",
            )
            .run(ts, run.taskId, run.id);
          // B2 Phase 1 step 3/5 — dual-write: cascade to the shadow
          // lease row so a task-delete does not leave an orphan lease
          // behind. The FK on `task_leases.task_id` would also cascade
          // via the DELETE at the end of this transaction; we clear
          // here explicitly so the intermediate state (task still
          // present, lease already gone) matches what `releaseTaskLock`
          // would have done if the delete had gone through the normal
          // lifecycle path.
          getDb()
            .prepare("DELETE FROM task_leases WHERE task_id = ? AND run_id = ?")
            .run(run.taskId, run.id);
          if (run.workspaceId) {
            getDb()
              .prepare(
                `update workspaces
                   set lock_holder_run_id = null, lock_acquired_at = null, state = 'ready', updated_at = ?
                 where id = ? and lock_holder_run_id = ?`,
              )
              .run(ts, run.workspaceId, run.id);
          }
        }
        getDb()
          .prepare(
            "update tasks set parent_id = null where parent_id = ? and company_id = ?",
          )
          .run(id, companyId);
        getDb()
          .prepare("delete from approvals where related_task_id = ? and company_id = ?")
          .run(id, companyId);
        getDb()
          .prepare("delete from task_comments where task_id = ? and company_id = ?")
          .run(id, companyId);
        getDb()
          .prepare("delete from tasks where id = ? and company_id = ?")
          .run(id, companyId);
      });
    },

    getRecentRunsForTask(
      taskId: string,
      limit: number,
    ): Array<{
      id: string;
      status: string;
      summary: string | null;
      errorMessage: string | null;
      finishedAt: string | null;
      connectorId: string;
    }> {
      return readAll(
        `SELECT id, status, summary, error_message as errorMessage,
       finished_at as finishedAt, connector_id as connectorId
       FROM runs WHERE task_id = ? ORDER BY finished_at DESC, rowid DESC LIMIT ?`,
        taskId,
        limit,
      );
    },

    getRecentActivityForTask(
      taskId: string,
      limit: number,
    ): Array<{
      action: string;
      detail: string;
      createdAt: string;
    }> {
      return readAll(
        `SELECT action, detail, created_at as createdAt
       FROM activity WHERE entity_type = 'task' AND entity_id = ?
       ORDER BY created_at DESC LIMIT ?`,
        taskId,
        limit,
      );
    },

    setTaskType(taskId: string, taskType: string): void {
      const ts = nowIso();
      getDb()
        .prepare("update tasks set task_type = ?, updated_at = ? where id = ?")
        .run(taskType, ts, taskId);
    },

    getTaskRetryCount(taskId: string): number {
      const row = getDb()
        .prepare("select retry_count from tasks where id = ?")
        .get(taskId) as { retry_count: number } | undefined;
      return row?.retry_count ?? 0;
    },

    incrementTaskRetryCount(taskId: string): void {
      const ts = nowIso();
      getDb()
        .prepare(
          "update tasks set retry_count = retry_count + 1, last_failure_at = ?, updated_at = ? where id = ?",
        )
        .run(ts, ts, taskId);
    },

    resetTaskRetryCount(taskId: string): void {
      const ts = nowIso();
      getDb()
        .prepare(
          "update tasks set retry_count = 0, last_failure_at = null, updated_at = ? where id = ?",
        )
        .run(ts, taskId);
    },

    /**
     * Returns `task_type` for a single task id, or null when the task is
     * missing. Used by checkpoint-engine to branch on task type without
     * loading the full row.
     */
    getTaskType(taskId: string): string | null {
      const row = getDb()
        .prepare("SELECT task_type as taskType FROM tasks WHERE id = ? LIMIT 1")
        .get(taskId) as { taskType: string | null } | undefined;
      return row?.taskType ?? null;
    },

  };
}
