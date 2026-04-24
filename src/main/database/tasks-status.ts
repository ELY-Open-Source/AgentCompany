import type { DatabaseSync } from "node:sqlite";
import type { TaskRecord } from "@shared/types";
import {
  type ReadAll,
  type Transaction,
  nowIso,
  taskPriorityOrderSql,
} from "./helpers";
import { chooseBestTaskAssignee } from "./task-assignment";
import { checkoutTaskInTransaction } from "./task-checkout";
import { guardInReviewHasReviewer } from "./task-review-guard";
import { assertValidTaskStatus, buildTaskStatusTransition } from "./task-status-rules";
import { STALE_LOCK_TIMEOUT_MS } from "../constants";

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

  return {
    advanceTaskStatus(
      taskId: string,
      newStatus: string,
      comment?: string,
    ): { previousStatus: string } {
      assertValidTaskStatus(newStatus);
      const task = getDb()
        .prepare("select status, company_id from tasks where id = ?")
        .get(taskId) as { status: string; company_id: string } | undefined;
      if (!task) throw new Error(`Task not found: ${taskId}`);
      const previousStatus = task.status;
      if (previousStatus === newStatus) return { previousStatus };
      if (newStatus === "in_review") guardInReviewHasReviewer(readAll, taskId);
      const ts = nowIso();
      const transition = buildTaskStatusTransition(newStatus, ts);
      transaction(() => {
        getDb()
          .prepare(
            `UPDATE tasks SET ${transition.sets.join(", ")} WHERE id = ?`,
          )
          .run(...transition.values, taskId);
        if (newStatus !== "in_progress") {
          getDb().prepare("delete from task_leases where task_id = ?").run(taskId);
        }
      });

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

    listReviewTasksForManager(managerId: string, companyId: string): TaskRecord[] {
      return readAll<TaskRecord>(
        `select t.id, t.company_id as companyId, t.project_id as projectId, t.goal_id as goalId,
              t.parent_id as parentId, t.title, t.description,
              t.assignee_agent_id as assigneeAgentId, t.workspace_id as workspaceId,
              t.status, t.priority,
              (select l.run_id from task_leases l where l.task_id = t.id) as activeRunId,
              t.cost_usd as costUsd,
              t.created_at as createdAt, t.updated_at as updatedAt
       from tasks t
       inner join agents a on t.assignee_agent_id = a.id
       where t.company_id = ? and t.status = 'in_review' and a.reports_to = ?
       order by ${taskPriorityOrderSql("t.priority")} desc, t.created_at asc`,
        companyId,
        managerId,
      );
    },

    checkoutTask(taskId: string, runId: string): boolean {
      return transaction(() => checkoutTaskInTransaction(getDb(), taskId, runId));
    },

    releaseTaskLock(taskId: string, runId: string): void {
      getDb()
        .prepare("delete from task_leases where task_id = ? and run_id = ?")
        .run(taskId, runId);
    },

    renewTaskLease(taskId: string, runId: string): boolean {
      const ts = nowIso();
      const expiresAt = new Date(Date.now() + STALE_LOCK_TIMEOUT_MS).toISOString();
      const result = getDb()
        .prepare(
          "update task_leases set renewed_at = ?, expires_at = ?, updated_at = ? where task_id = ? and run_id = ?",
        )
        .run(ts, expiresAt, ts, taskId, runId);
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
