import type { DatabaseSync } from "node:sqlite";
import type { TaskRecord } from "@shared/types";
import { type ReadAll, type Transaction, taskPriorityOrderSql } from "./helpers";
import type { TaskListByStatusesRow } from "./tasks-crud";

/**
 * Task list/aggregate read queries extracted from tasks-crud.ts.
 *
 * Every method is spread into the final `buildTaskMethods` result so
 * AppDatabase call-sites remain unchanged.
 */
export function buildTaskQueryMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  _transaction: Transaction,
) {
  return {
    /**
     * Returns actionable real work for an agent.
     */
    listAgentTasks(
      agentId: string,
      companyId: string,
      statuses: string[],
    ): TaskRecord[] {
      const placeholders = statuses.map(() => "?").join(",");
      return readAll<TaskRecord>(
        `select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, (select l.run_id from task_leases l where l.task_id = tasks.id) as activeRunId, cost_usd as costUsd, task_type as taskType, created_at as createdAt, updated_at as updatedAt
         from tasks
        where company_id = ? and assignee_agent_id = ? and status in (${placeholders})
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
      );
    },

    /**
     * Returns the slim task projection (id, title, status, priority) for a
     * single assignee, ordered by created_at desc.
     */
    listAssigneeTasksForStandup(
      companyId: string,
      agentId: string,
    ): Array<{ id: string; title: string; status: string; priority: string }> {
      return readAll(
        "select id, title, status, priority from tasks where company_id = ? and assignee_agent_id = ? order by created_at desc",
        companyId,
        agentId,
      );
    },

    /**
     * Returns the slim task projection for a set of assignees. Safe on
     * an empty assignee list (returns []).
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
        `select id, title, status, priority, assignee_agent_id as assigneeAgentId from tasks where company_id = ? and assignee_agent_id in (${placeholders}) order by created_at desc`,
        companyId,
        ...assigneeIds,
      );
    },

    /**
     * Returns tasks filtered by status.
     */
    listTasksByStatuses(
      companyId: string,
      statuses: string[],
    ): TaskListByStatusesRow[] {
      const placeholders = statuses.map(() => "?").join(", ");
      return readAll<TaskListByStatusesRow & { requiresUserReview: number | boolean }>(
        `select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, (select l.run_id from task_leases l where l.task_id = tasks.id) as activeRunId, cost_usd as costUsd, requires_user_review as requiresUserReview, started_at as startedAt, completed_at as completedAt, cancelled_at as cancelledAt, created_at as createdAt, updated_at as updatedAt from tasks where company_id = ? and status in (${placeholders}) order by created_at desc`,
        companyId,
        ...statuses,
      ).map((t) => ({
        ...t,
        requiresUserReview: Boolean(t.requiresUserReview),
        startedAt: t.startedAt ?? null,
        completedAt: t.completedAt ?? null,
        cancelledAt: t.cancelledAt ?? null,
      })) as TaskListByStatusesRow[];
    },

    countActiveTasksForCompany(companyId: string): number {
      const row = getDb()
        .prepare(
          "select count(*) as cnt from tasks where company_id = ? and status not in ('done', 'cancelled')",
        )
        .get(companyId) as { cnt: number };
      return row.cnt;
    },

    /**
     * Count tasks that are actively producing progress this cycle —
     * todo (waiting to be checked out) and in_progress (currently being
     * worked). Excludes in_review (waiting on a human or manager) and
     * blocked (waiting on a resolution). Used by the bootstrap
     * scheduler to decide whether the CEO needs to be pinged: a company
     * where every task is stuck in review or blocked is functionally
     * idle even though countActiveTasksForCompany reports > 0.
     */
    countAdvancingTasksForCompany(companyId: string): number {
      const row = getDb()
        .prepare(
          "select count(*) as cnt from tasks where company_id = ? and status in ('todo','in_progress')",
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
  };
}
