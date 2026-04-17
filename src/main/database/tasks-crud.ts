import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { TaskRecord, TaskSessionRecord } from "@shared/types";
import {
  type ReadAll,
  type Transaction,
  ensureId,
  normalizeOptionalId,
  nowIso,
  taskPriorityOrderSql,
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
  sessionJson: string | null;
  sessionDisplayId: string | null;
  costUsd: number | null;
  requiresUserReview: boolean;
  isHeartbeat: boolean;
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
        getDb()
          .prepare(
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
            "insert into tasks (id, company_id, project_id, goal_id, parent_id, title, description, assignee_agent_id, workspace_id, status, priority, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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

    /**
     * Returns actionable real work for an agent. Heartbeat tasks are
     * excluded by default since they are synthesized wake-up placeholders;
     * pass `{ includeHeartbeat: true }` to include them (heartbeat-loop
     * callers that already filter by `is_heartbeat` do not need this).
     */
    listAgentTasks(
      agentId: string,
      companyId: string,
      statuses: string[],
      options: { includeHeartbeat?: boolean } = {},
    ): TaskRecord[] {
      const placeholders = statuses.map(() => "?").join(",");
      const heartbeatClause = options.includeHeartbeat ? "" : " and is_heartbeat = 0";
      return readAll<TaskRecord>(
        `select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, active_run_id as activeRunId, session_json as sessionJson, session_display_id as sessionDisplayId, cost_usd as costUsd, task_type as taskType, is_heartbeat as isHeartbeat, created_at as createdAt, updated_at as updatedAt
         from tasks
        where company_id = ? and assignee_agent_id = ? and status in (${placeholders})${heartbeatClause}
        order by
          case status
            when 'in_progress' then 0
            when 'todo' then 1
            when 'blocked' then 2
            when 'backlog' then 3
            else 4
          end asc,
          ${taskPriorityOrderSql("priority")} desc,
          created_at asc`,
        companyId,
        agentId,
        ...statuses,
      ).map((t) => ({ ...t, isHeartbeat: Boolean(t.isHeartbeat) }));
    },

    /**
     * Returns the slim task projection (id, title, status, priority) for a
     * single assignee, ordered by created_at desc. Used by the alternate
     * me/standup builder in routes-agents-standup.ts. Heartbeat tasks are
     * excluded so UI aggregations do not surface synthetic wake tasks.
     */
    listAssigneeTasksForStandup(
      companyId: string,
      agentId: string,
    ): Array<{ id: string; title: string; status: string; priority: string }> {
      return readAll(
        "select id, title, status, priority from tasks where company_id = ? and assignee_agent_id = ? and is_heartbeat = 0 order by created_at desc",
        companyId,
        agentId,
      );
    },

    /**
     * Returns the slim task projection for a set of assignees. Safe on
     * an empty assignee list (returns []). Used by the alternate
     * me/standup builder to fetch reports' tasks in one query. Heartbeat
     * tasks are excluded.
     */
    listTasksForAssignees(
      companyId: string,
      assigneeIds: string[],
    ): Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      assigneeAgentId: string;
    }> {
      if (assigneeIds.length === 0) return [];
      const placeholders = assigneeIds.map(() => "?").join(",");
      return readAll(
        `select id, title, status, priority, assignee_agent_id as assigneeAgentId from tasks where company_id = ? and assignee_agent_id in (${placeholders}) and is_heartbeat = 0 order by created_at desc`,
        companyId,
        ...assigneeIds,
      );
    },

    /**
     * Returns the slim task projection used by the me/standup aggregation.
     * Ordered by created_at desc. Heartbeat tasks are excluded.
     */
    listTasksForStandup(companyId: string): Array<{
      id: string;
      companyId: string;
      title: string;
      assigneeAgentId: string | null;
      status: string;
      priority: string;
    }> {
      return readAll(
        "select id, company_id as companyId, title, assignee_agent_id as assigneeAgentId, status, priority from tasks where company_id = ? and is_heartbeat = 0 order by created_at desc",
        companyId,
      );
    },

    /**
     * Returns tasks filtered by status. Heartbeat tasks are excluded by
     * default — they are synthesized wake placeholders and should not
     * appear in the user-facing issue list. Pass `{ includeHeartbeat: true }`
     * to include them.
     */
    listTasksByStatuses(
      companyId: string,
      statuses: string[],
      options: { includeHeartbeat?: boolean } = {},
    ): TaskListByStatusesRow[] {
      const placeholders = statuses.map(() => "?").join(", ");
      const heartbeatClause = options.includeHeartbeat ? "" : " and is_heartbeat = 0";
      return readAll<TaskListByStatusesRow & { requiresUserReview: number | boolean; isHeartbeat: number | boolean }>(
        `select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, active_run_id as activeRunId, session_json as sessionJson, session_display_id as sessionDisplayId, cost_usd as costUsd, requires_user_review as requiresUserReview, is_heartbeat as isHeartbeat, started_at as startedAt, completed_at as completedAt, cancelled_at as cancelledAt, created_at as createdAt, updated_at as updatedAt from tasks where company_id = ? and status in (${placeholders})${heartbeatClause} order by created_at desc`,
        companyId,
        ...statuses,
      ).map((t) => ({
        ...t,
        requiresUserReview: Boolean(t.requiresUserReview),
        isHeartbeat: Boolean(t.isHeartbeat),
        startedAt: t.startedAt ?? null,
        completedAt: t.completedAt ?? null,
        cancelledAt: t.cancelledAt ?? null,
      })) as TaskListByStatusesRow[];
    },

    countActiveTasksForCompany(companyId: string): number {
      const row = getDb()
        .prepare(
          "select count(*) as cnt from tasks where company_id = ? and status not in ('done', 'cancelled') and is_heartbeat = 0",
        )
        .get(companyId) as { cnt: number };
      return row.cnt;
    },

    listChildTasks(
      parentId: string,
      companyId: string,
    ): Array<{ id: string; status: string; assigneeAgentId: string | null }> {
      return readAll<{ id: string; status: string; assigneeAgentId: string | null }>(
        `select id, status, assignee_agent_id as assigneeAgentId from tasks where parent_id = ? and company_id = ?`,
        parentId,
        companyId,
      );
    },

    updateTaskSession(
      taskId: string,
      sessionJson: Record<string, unknown> | null,
      sessionDisplayId: string | null,
    ): void {
      const ts = nowIso();
      const sessionParamsJson = sessionJson ? JSON.stringify(sessionJson) : null;
      const taskRow = getDb()
        .prepare(
          "select company_id as companyId, assignee_agent_id as assigneeAgentId, active_session_id as activeSessionId from tasks where id = ?",
        )
        .get(taskId) as
        | { companyId: string; assigneeAgentId: string | null; activeSessionId: string | null }
        | undefined;
      if (!taskRow) throw new Error(`Task not found: ${taskId}`);
      if (taskRow.activeSessionId) {
        getDb()
          .prepare(
            "update task_sessions set session_params_json = ?, session_display_id = ?, updated_at = ? where id = ?",
          )
          .run(sessionParamsJson, sessionDisplayId, ts, taskRow.activeSessionId);
        return;
      }
      if (sessionParamsJson === null && sessionDisplayId === null) return;
      const agentId = taskRow.assigneeAgentId ?? "unassigned";
      const agent = taskRow.assigneeAgentId
        ? (getDb()
            .prepare("select connector_id as connectorId from agents where id = ?")
            .get(taskRow.assigneeAgentId) as { connectorId: string } | undefined)
        : undefined;
      const adapterType = agent?.connectorId ?? "unknown";
      const sessionId = randomUUID();
      getDb()
        .prepare(
          `insert into task_sessions (id, company_id, task_id, agent_id, adapter_type, session_params_json, session_display_id, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sessionId,
          taskRow.companyId,
          taskId,
          agentId,
          adapterType,
          sessionParamsJson,
          sessionDisplayId,
          ts,
          ts,
        );
      getDb()
        .prepare("update tasks set active_session_id = ?, updated_at = ? where id = ?")
        .run(sessionId, ts, taskId);
    },

    getTaskSession(taskId: string): {
      sessionParams: Record<string, unknown> | null;
      sessionDisplayId: string | null;
    } {
      const taskRow = getDb()
        .prepare("select active_session_id as activeSessionId from tasks where id = ?")
        .get(taskId) as { activeSessionId: string | null } | undefined;
      if (!taskRow?.activeSessionId) {
        return { sessionParams: null, sessionDisplayId: null };
      }
      const row = getDb()
        .prepare(
          "select session_params_json as sessionParamsJson, session_display_id as sessionDisplayId from task_sessions where id = ?",
        )
        .get(taskRow.activeSessionId) as
        | { sessionParamsJson: string | null; sessionDisplayId: string | null }
        | undefined;
      let sessionParams: Record<string, unknown> | null = null;
      if (row?.sessionParamsJson) {
        sessionParams = JSON.parse(row.sessionParamsJson) as Record<string, unknown>;
      }
      return {
        sessionParams,
        sessionDisplayId: row?.sessionDisplayId ?? null,
      };
    },

    getActiveTaskSession(taskId: string): TaskSessionRecord | null {
      const task = getDb()
        .prepare("SELECT active_session_id FROM tasks WHERE id = ?")
        .get(taskId) as { active_session_id: string | null } | undefined;
      if (!task?.active_session_id) return null;
      return (
        (getDb()
          .prepare(
            `SELECT id, company_id as companyId, task_id as taskId, agent_id as agentId,
       adapter_type as adapterType, session_params_json as sessionParamsJson,
       session_display_id as sessionDisplayId, last_run_id as lastRunId,
       last_error as lastError, run_count as runCount,
       total_input_tokens as totalInputTokens, total_output_tokens as totalOutputTokens,
       rotated_at as rotatedAt, rotation_reason as rotationReason,
       handoff_markdown as handoffMarkdown, created_at as createdAt, updated_at as updatedAt
       FROM task_sessions WHERE id = ?`,
          )
          .get(task.active_session_id) as TaskSessionRecord | undefined) ?? null
      );
    },

    incrementSessionUsage(
      sessionId: string,
      inputTokens: number,
      outputTokens: number,
      runId: string,
    ): void {
      const ts = nowIso();
      getDb()
        .prepare(
          `UPDATE task_sessions
       SET run_count = run_count + 1,
           total_input_tokens = total_input_tokens + ?,
           total_output_tokens = total_output_tokens + ?,
           last_run_id = ?,
           updated_at = ?
       WHERE id = ?`,
        )
        .run(inputTokens, outputTokens, runId, ts, sessionId);
    },

    archiveSession(sessionId: string, reason: string, handoffMarkdown: string): void {
      const ts = nowIso();
      getDb()
        .prepare(
          `UPDATE task_sessions SET rotated_at = ?, rotation_reason = ?, handoff_markdown = ?, updated_at = ? WHERE id = ?`,
        )
        .run(ts, reason, handoffMarkdown, ts, sessionId);
    },

    createNewSession(input: {
      taskId: string;
      companyId: string;
      agentId: string;
      adapterType: string;
      sessionParamsJson: string | null;
      sessionDisplayId: string | null;
    }): string {
      const sessionId = randomUUID();
      const ts = nowIso();
      getDb()
        .prepare(
          `INSERT INTO task_sessions (id, company_id, task_id, agent_id, adapter_type,
       session_params_json, session_display_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sessionId,
          input.companyId,
          input.taskId,
          input.agentId,
          input.adapterType,
          input.sessionParamsJson,
          input.sessionDisplayId,
          ts,
          ts,
        );
      getDb()
        .prepare("UPDATE tasks SET active_session_id = ?, updated_at = ? WHERE id = ?")
        .run(sessionId, ts, input.taskId);
      return sessionId;
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
     * Returns the set of distinct assignee agent ids on tasks in a project,
     * excluding unassigned tasks. Used by message-dispatch to fan out wake
     * targets for a project channel.
     */
    listProjectTaskAssigneeIds(projectId: string, companyId: string): string[] {
      const rows = readAll<{ assigneeAgentId: string | null }>(
        "select distinct assignee_agent_id as assigneeAgentId from tasks where project_id = ? and company_id = ? and assignee_agent_id is not null",
        projectId,
        companyId,
      );
      return rows.map((r) => r.assigneeAgentId).filter((id): id is string => id !== null);
    },

    /**
     * Returns assignee agent ids for a set of task ids scoped to a company.
     * Used by task-quality-gates sweep to find reviewers of in-review tasks
     * that have exceeded the review timeout.
     */
    listReviewTasksForSweep(companyId: string): Array<{
      id: string;
      assigneeAgentId: string | null;
      updatedAt: string;
      title: string;
    }> {
      return readAll(
        `SELECT id, assignee_agent_id as assigneeAgentId, updated_at as updatedAt, title
         FROM tasks
         WHERE company_id = ? AND status = 'in_review'`,
        companyId,
      );
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
