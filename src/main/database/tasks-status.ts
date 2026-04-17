import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { TaskRecord } from "@shared/types";
import {
  type ReadAll,
  type Transaction,
  nowIso,
  taskPriorityOrderSql,
} from "./helpers";
import { chooseBestTaskAssignee } from "./task-assignment";

export function buildTaskStatusMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    addComment: (input: { companyId: string; taskId: string; authorAgentId: string | null; authorName: string; body: string }) => void;
    addActivity: (input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) => void;
  },
) {
  function incrementActiveSprintVelocity(companyId: string, delta: number): void {
    const ts = nowIso();
    const today = ts.slice(0, 10);
    getDb()
      .prepare(
        "update sprints set completed_points = max(0, completed_points + ?), updated_at = ? where company_id = ? and status = 'active' and start_date <= ? and end_date >= ?",
      )
      .run(delta, ts, companyId, today, today);
  }

  const VALID_TASK_STATUSES = new Set([
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "done",
    "blocked",
    "cancelled",
  ]);

  return {
    advanceTaskStatus(
      taskId: string,
      newStatus: string,
      comment?: string,
    ): { previousStatus: string } {
      if (!VALID_TASK_STATUSES.has(newStatus)) {
        throw new Error(`Invalid task status: ${newStatus}`);
      }
      const task = getDb()
        .prepare("select status, company_id from tasks where id = ?")
        .get(taskId) as { status: string; company_id: string } | undefined;
      if (!task) throw new Error(`Task not found: ${taskId}`);
      const previousStatus = task.status;
      if (previousStatus === newStatus) return { previousStatus };
      const ts = nowIso();

      // Status side-effect timestamps (Paperclip pattern)
      const timestampSets: string[] = ["status = ?", "updated_at = ?"];
      const timestampValues: (string | null)[] = [newStatus, ts];

      if (newStatus === "in_progress") {
        // Set startedAt only once (first time entering in_progress)
        timestampSets.push("started_at = COALESCE(started_at, ?)");
        timestampValues.push(ts);
      }
      if (newStatus === "done") {
        timestampSets.push("completed_at = ?");
        timestampValues.push(ts);
      } else {
        timestampSets.push("completed_at = NULL");
      }
      if (newStatus === "cancelled") {
        timestampSets.push("cancelled_at = ?");
        timestampValues.push(ts);
      } else {
        timestampSets.push("cancelled_at = NULL");
      }
      if (newStatus !== "in_progress") {
        timestampSets.push("checkout_run_id = NULL");
      }

      getDb()
        .prepare(`UPDATE tasks SET ${timestampSets.join(", ")} WHERE id = ?`)
        .run(...timestampValues, taskId);

      if (comment) {
        deps.addComment({
          companyId: task.company_id,
          taskId,
          authorAgentId: null,
          authorName: "System",
          body: comment,
        });
      }
      if (newStatus === "done" && previousStatus !== "done") {
        incrementActiveSprintVelocity(task.company_id, 1);
      }
      if (previousStatus === "done" && newStatus !== "done") {
        incrementActiveSprintVelocity(task.company_id, -1);
      }
      return { previousStatus };
    },

    findReusableHeartbeatTask(agentId: string, companyId: string): TaskRecord | null {
      const row = getDb()
        .prepare(
          `SELECT id, company_id as companyId, project_id as projectId, goal_id as goalId,
                parent_id as parentId, title, description,
                assignee_agent_id as assigneeAgentId, workspace_id as workspaceId,
                status, priority, active_run_id as activeRunId,
                session_json as sessionJson, session_display_id as sessionDisplayId,
                cost_usd as costUsd, requires_user_review as requiresUserReview,
                is_heartbeat as isHeartbeat,
                created_at as createdAt, updated_at as updatedAt
         FROM tasks
         WHERE company_id = ? AND assignee_agent_id = ? AND is_heartbeat = 1
           AND status IN ('done', 'in_review')
         ORDER BY updated_at DESC, rowid DESC
         LIMIT 1`,
        )
        .get(companyId, agentId) as TaskRecord | undefined;
      if (row) {
        row.requiresUserReview = Boolean(row.requiresUserReview);
        row.isHeartbeat = Boolean(row.isHeartbeat);
      }
      return row ?? null;
    },

    acquireHeartbeatTask(input: {
      agentId: string;
      companyId: string;
      runId: string;
      workspaceId: string | null;
      title: string;
      description: string;
      priority: string;
    }): TaskRecord | null {
      return transaction<TaskRecord | null>(() => {
        const ts = nowIso();
        const db = getDb();

        const claimable = db
          .prepare(
            `SELECT id, status FROM tasks
             WHERE company_id = ? AND assignee_agent_id = ? AND is_heartbeat = 1
               AND status IN ('todo', 'backlog', 'done', 'in_review')
               AND checkout_run_id IS NULL
             ORDER BY
               CASE status WHEN 'todo' THEN 0 WHEN 'backlog' THEN 1 WHEN 'in_review' THEN 2 WHEN 'done' THEN 3 ELSE 4 END ASC,
               updated_at DESC, rowid DESC
             LIMIT 1`,
          )
          .get(input.companyId, input.agentId) as { id: string; status: string } | undefined;

        let taskId: string | null = null;
        if (claimable) {
          const claimResult = db
            .prepare(
              `UPDATE tasks
                 SET checkout_run_id = ?, execution_locked_at = ?, status = 'in_progress',
                     started_at = COALESCE(started_at, ?), completed_at = NULL, cancelled_at = NULL,
                     updated_at = ?
               WHERE id = ? AND checkout_run_id IS NULL
                 AND status IN ('todo', 'backlog', 'done', 'in_review')`,
            )
            .run(input.runId, ts, ts, ts, claimable.id);
          if (claimResult.changes > 0) {
            taskId = claimable.id;
          } else {
            return null;
          }
        } else {
          const inflight = db
            .prepare(
              `SELECT 1 FROM tasks
               WHERE company_id = ? AND assignee_agent_id = ? AND is_heartbeat = 1
                 AND status NOT IN ('done', 'cancelled')
               LIMIT 1`,
            )
            .get(input.companyId, input.agentId);
          if (inflight) return null;

          taskId = randomUUID();
          db.prepare(
            `INSERT INTO tasks
               (id, company_id, project_id, goal_id, parent_id, title, description,
                assignee_agent_id, workspace_id, status, priority,
                checkout_run_id, execution_locked_at, started_at, is_heartbeat,
                created_at, updated_at)
             VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, 1, ?, ?)`,
          ).run(
            taskId,
            input.companyId,
            input.title,
            input.description,
            input.agentId,
            input.workspaceId,
            input.priority,
            input.runId,
            ts,
            ts,
            ts,
            ts,
          );
        }

        const row = db
          .prepare(
            `SELECT id, company_id as companyId, project_id as projectId, goal_id as goalId,
                    parent_id as parentId, title, description,
                    assignee_agent_id as assigneeAgentId, workspace_id as workspaceId,
                    status, priority, active_run_id as activeRunId,
                    session_json as sessionJson, session_display_id as sessionDisplayId,
                    cost_usd as costUsd, requires_user_review as requiresUserReview,
                    is_heartbeat as isHeartbeat, task_type as taskType,
                    started_at as startedAt, completed_at as completedAt, cancelled_at as cancelledAt,
                    created_at as createdAt, updated_at as updatedAt
             FROM tasks WHERE id = ?`,
          )
          .get(taskId) as TaskRecord | undefined;
        if (!row) return null;
        row.requiresUserReview = Boolean(row.requiresUserReview);
        row.isHeartbeat = Boolean(row.isHeartbeat);
        row.startedAt = row.startedAt ?? null;
        row.completedAt = row.completedAt ?? null;
        row.cancelledAt = row.cancelledAt ?? null;
        return row;
      });
    },

    cleanupDuplicateHeartbeatTasks(companyId: string): number {
      const ts = nowIso();
      const result = getDb()
        .prepare(
          `UPDATE tasks SET status = 'cancelled', updated_at = ?
         WHERE company_id = ? AND is_heartbeat = 1
           AND status IN ('done', 'in_review', 'todo', 'blocked', 'backlog')
           AND id NOT IN (
             SELECT id FROM (
               SELECT id, ROW_NUMBER() OVER (PARTITION BY assignee_agent_id ORDER BY updated_at DESC, rowid DESC) as rn
               FROM tasks
               WHERE company_id = ? AND is_heartbeat = 1 AND status != 'cancelled'
             ) WHERE rn = 1
           )`,
        )
        .run(ts, companyId, companyId);
      return Number(result.changes);
    },

    listReviewTasksForManager(managerId: string, companyId: string): TaskRecord[] {
      return readAll<TaskRecord>(
        `select t.id, t.company_id as companyId, t.project_id as projectId, t.goal_id as goalId,
              t.parent_id as parentId, t.title, t.description,
              t.assignee_agent_id as assigneeAgentId, t.workspace_id as workspaceId,
              t.status, t.priority, t.active_run_id as activeRunId,
              t.session_json as sessionJson, t.session_display_id as sessionDisplayId,
              t.cost_usd as costUsd, t.is_heartbeat as isHeartbeat,
              t.created_at as createdAt, t.updated_at as updatedAt
       from tasks t
       inner join agents a on t.assignee_agent_id = a.id
       where t.company_id = ? and t.status = 'in_review' and a.reports_to = ? and t.is_heartbeat = 0
       order by ${taskPriorityOrderSql("t.priority")} desc, t.created_at asc`,
        companyId,
        managerId,
      );
    },

    checkoutTask(taskId: string, runId: string): boolean {
      const ts = nowIso();
      const result = getDb()
        .prepare(
          `UPDATE tasks
           SET checkout_run_id = ?, execution_locked_at = ?, status = 'in_progress', updated_at = ?
         WHERE id = ?
           AND checkout_run_id IS NULL
           AND status IN ('todo', 'backlog')`,
        )
        .run(runId, ts, ts, taskId);
      return result.changes > 0;
    },

    releaseTaskLock(taskId: string, runId: string): void {
      getDb()
        .prepare(
          "UPDATE tasks SET checkout_run_id = NULL, execution_locked_at = NULL, updated_at = ? WHERE id = ? AND checkout_run_id = ?",
        )
        .run(nowIso(), taskId, runId);
    },

    renewTaskLease(taskId: string, runId: string): boolean {
      const ts = nowIso();
      const result = getDb()
        .prepare(
          "UPDATE tasks SET execution_locked_at = ?, updated_at = ? WHERE id = ? AND checkout_run_id = ?",
        )
        .run(ts, ts, taskId, runId);
      return result.changes > 0;
    },

    setTaskRequiresUserReview(taskId: string, value: boolean): void {
      const ts = nowIso();
      getDb()
        .prepare("update tasks set requires_user_review = ?, updated_at = ? where id = ?")
        .run(value ? 1 : 0, ts, taskId);
    },

    hasPendingDeliverableReviews(companyId: string): boolean {
      const approval = getDb()
        .prepare(
          "select 1 from approvals where company_id = ? and type = 'deliverable_review' and state = 'pending' limit 1",
        )
        .get(companyId);
      if (approval) return true;
      const flaggedTask = getDb()
        .prepare(
          "select 1 from tasks where company_id = ? and requires_user_review = 1 limit 1",
        )
        .get(companyId);
      return !!flaggedTask;
    },

    hasAgentPendingDeliverableReview(agentId: string, companyId: string): boolean {
      const row = getDb()
        .prepare(
          `select 1 from approvals a
       join tasks t on a.related_task_id = t.id
       where a.company_id = ? and a.type = 'deliverable_review' and a.state = 'pending'
         and t.assignee_agent_id = ?
       limit 1`,
        )
        .get(companyId, agentId);
      return !!row;
    },

    hasAgentTaskAwaitingReview(agentId: string, companyId: string): boolean {
      const row = getDb()
        .prepare(
          "select 1 from tasks where assignee_agent_id = ? and company_id = ? and requires_user_review = 1 limit 1",
        )
        .get(agentId, companyId);
      return !!row;
    },

    autoAssignTask(taskId: string, companyId: string): string | null {
      const task = getDb()
        .prepare(
          "select id, title, description, project_id as projectId, assignee_agent_id as assigneeAgentId from tasks where id = ? and company_id = ?",
        )
        .get(taskId, companyId) as
        | {
            id: string;
            title: string;
            description: string;
            projectId: string | null;
            assigneeAgentId: string | null;
          }
        | undefined;
      if (!task) return null;

      // If task already has an assignee, return them (don't reassign)
      if (task.assigneeAgentId) return task.assigneeAgentId;

      // Get eligible agents: active/idle with remaining budget
      const candidates = readAll<{
        id: string;
        name: string;
        department: string | null;
        capabilities: string;
        taskCount: number;
        budgetMonthlyUsd: number;
        spentMonthlyUsd: number;
      }>(
        `select a.id, a.name, a.department, a.capabilities,
        a.budget_monthly_usd as budgetMonthlyUsd, a.spent_monthly_usd as spentMonthlyUsd,
        (select count(*) from tasks t where t.assignee_agent_id = a.id and t.status in ('todo', 'in_progress')) as taskCount
      from agents a
      where a.company_id = ? and a.status in ('idle', 'active')
      order by taskCount asc`,
        companyId,
      );

      const bestAgent = chooseBestTaskAssignee(getDb, readAll, companyId, task, candidates);
      if (!bestAgent) return null;

      getDb()
        .prepare(
          "update tasks set assignee_agent_id = ?, updated_at = ? where id = ? and company_id = ?",
        )
        .run(bestAgent, nowIso(), taskId, companyId);
      deps.addActivity({
        companyId,
        actor: "system",
        action: "task.auto_assigned",
        entityType: "task",
        entityId: taskId,
        detail: `Auto-assigned to ${candidates.find((c) => c.id === bestAgent)?.name ?? bestAgent}`,
      });
      return bestAgent;
    },

    retryInterruptedTask(
      taskId: string,
      _agentId: string,
      _companyId: string,
    ): void {
      const ts = nowIso();
      getDb()
        .prepare("update tasks set status = 'todo', updated_at = ? where id = ?")
        .run(ts, taskId);
      getDb()
        .prepare(
          "update tasks set retry_count = 0, last_failure_at = null, updated_at = ? where id = ?",
        )
        .run(ts, taskId);
    },

    dismissInterruptedTask(taskId: string): void {
      const taskRow = getDb()
        .prepare("select company_id from tasks where id = ?")
        .get(taskId) as { company_id: string } | undefined;
      deps.addComment({
        companyId: taskRow?.company_id ?? "",
        taskId,
        authorAgentId: null,
        authorName: "System",
        body: "Interrupted run dismissed by user. Task remains blocked for manual handling.",
      });
    },

    markInterruptedTaskFailed(taskId: string): void {
      const ts = nowIso();
      getDb()
        .prepare("update tasks set status = 'cancelled', updated_at = ? where id = ?")
        .run(ts, taskId);
    },
  };
}
