import type { DatabaseSync } from "node:sqlite";
import type { TaskRecord } from "@shared/types";
import {
  type ReadAll,
  type Transaction,
  nowIso,
  taskPriorityOrderSql,
} from "./helpers";
import { chooseBestTaskAssignee } from "./task-assignment";

/**
 * Default lease TTL used when the dual-write path seeds `task_leases`
 * from the legacy `checkout_run_id` / `execution_locked_at` columns.
 * Matches the stale-lock timeout in database-base so the sweep logic
 * stays in sync across the shadow tables.
 */
const DUAL_WRITE_LEASE_TTL_MS = 15 * 60 * 1000;

/**
 * Mirror a successful legacy checkout onto the new `task_leases` row.
 *
 * Called from `checkoutTask` immediately after the legacy CAS succeeds.
 * `INSERT OR REPLACE` is safe here because the preceding SQL CAS
 * guarded on `checkout_run_id IS NULL` — any live lease row at this
 * point refers to the same run (replay under retry) or is itself stale
 * (recoverStaleLocks has not caught up yet). The new expires_at resets
 * the stale-lock sweep deadline either way.
 */
function writeCheckoutLease(
  db: DatabaseSync,
  taskId: string,
  runId: string,
  ts: string,
): void {
  const expiresAt = new Date(Date.now() + DUAL_WRITE_LEASE_TTL_MS).toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO task_leases
       (task_id, run_id, acquired_at, expires_at, checkout_run_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(taskId, runId, ts, expiresAt, runId);
}

export function buildTaskStatusMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    addComment: (input: { companyId: string; taskId: string; authorAgentId: string | null; authorName: string; body: string }) => void;
    addActivity: (input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) => void;
  },
) {
  // Terminal phases and "returned to queue" phases release any existing
  // lease: once a task is done/cancelled/blocked or bounced back to
  // todo/backlog the execution grant no longer has a referent. We mirror
  // that in `task_leases` explicitly — the status→phase trigger only
  // touches the phase column and leaves the lease row behind, producing
  // an orphan that the dev-mode consistency probe surfaces as a
  // divergence. Production would silently drift instead.
  const STATUSES_THAT_CLEAR_LEASE = new Set<string>([
    "done",
    "cancelled",
    "blocked",
    "todo",
    "backlog",
  ]);
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

  /**
   * Guard against the "in_review dead letter": a task whose assignee is
   * a top-level agent (reports_to IS NULL, the DB invariant CEO marker)
   * and that does not require user review has no reachable reviewer —
   * no manager to walk up to, and no human gate. Without this guard the
   * CEO heartbeat loops forever re-proposing the same approval.
   *
   * The right root fix is to reject the transition at source: a caller
   * that moves such a task into `in_review` must first set
   * requires_user_review=1 (escalate to human) or route differently
   * (advance to done, hire a reviewer, bounce to todo). Previous
   * versions silently resurrected these tasks at every DB init; this
   * replaces the startup side-effect with a clear runtime error.
   */
  function guardInReviewHasReviewer(taskId: string): void {
    const row = readAll<{ requiresUserReview: number; reportsTo: string | null }>(
      `select t.requires_user_review as requiresUserReview,
              a.reports_to as reportsTo
         from tasks t
         left join agents a on a.id = t.assignee_agent_id
        where t.id = ?`,
      taskId,
    )[0];
    if (!row) return;
    if (row.requiresUserReview === 1) return;
    if (row.reportsTo !== null) return;
    throw new Error(
      `Task ${taskId} has a top-level assignee and no reviewer: cannot enter in_review without requires_user_review=1.`,
    );
  }

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
      if (newStatus === "in_review") guardInReviewHasReviewer(taskId);
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
      // Returning a task to todo / backlog drops any active-run claim
      // as well — heartbeat picks candidate tasks by !activeRunId, so
      // leaving a stale pointer here (e.g. after startup recovery of a
      // crashed run) silently hides the task from every future wake.
      if (newStatus === "todo" || newStatus === "backlog") {
        timestampSets.push("active_run_id = NULL");
      }

      const shouldClearLease = STATUSES_THAT_CLEAR_LEASE.has(newStatus);
      transaction(() => {
        getDb()
          .prepare(
            // eslint-disable-next-line no-restricted-syntax -- B2 Phase 1 grandfathered: advanceTaskStatus is the sanctioned dynamic-SQL helper; timestampSets[0] is always the literal "status = ?". Status→phase trigger plus the explicit DELETE FROM task_leases below keep the shadow surface coherent.
            `UPDATE tasks SET ${timestampSets.join(", ")} WHERE id = ?`,
          )
          .run(...timestampValues, taskId);
        if (shouldClearLease) {
          // Drop any live lease row in the same transaction so no
          // caller observes the intermediate state of "task in terminal
          // or backlog phase, lease still present". `releaseTaskLock`
          // clears the lease on the happy path (normal run completion),
          // but terminal transitions can come from review timeouts,
          // retries, automation rules, etc. without ever going through
          // that helper.
          getDb()
            .prepare("DELETE FROM task_leases WHERE task_id = ?")
            .run(taskId);
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
              t.status, t.priority, t.active_run_id as activeRunId,
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
      const ts = nowIso();
      // Primary path is `status IN ('todo','backlog')`. The extra
      // `in_progress AND active_run_id IS NULL` branch recovers from a
      // specific orphan: finishRun has cleared active_run_id and
      // checkout_run_id for the previous run but the status transition
      // to done/in_review never fired (e.g. the run succeeded without a
      // deliverable and automation parked it at in_progress, or a
      // crashed run left the row behind). Without the reclaim, heartbeat
      // picks the task (activeRunId=null passes the candidate filter)
      // and then loops on `checkout_race_lost` forever because status
      // never flips back to todo on its own.
      //
      // The `active_run_id IS NULL` guard preserves the original CAS
      // contract for the busy case: a task whose active_run_id still
      // points at a live run is refused here, exactly as before.
      const result = getDb()
        .prepare(
          // eslint-disable-next-line no-restricted-syntax -- B2 Phase 1 grandfathered: checkoutTask CAS writes status='in_progress' as part of the atomic lock acquisition. The status→phase trigger mirrors to the new phase column and writeCheckoutLease below writes the shadow lease in the same call.
          `UPDATE tasks
           SET checkout_run_id = ?, execution_locked_at = ?, status = 'in_progress', updated_at = ?
         WHERE id = ?
           AND checkout_run_id IS NULL
           AND (
             status IN ('todo', 'backlog')
             OR (status = 'in_progress' AND active_run_id IS NULL)
           )`,
        )
        .run(runId, ts, ts, taskId);
      if (result.changes > 0) {
        // B2 Phase 1 step 3/5 — dual-write the new lease shadow. The
        // status → phase trigger from v50 already mirrored the phase
        // column by this point; the lease table still needs an explicit
        // write. Same-run re-acquires overwrite in place, different-run
        // acquires would return null (and should not happen here
        // because the SQL CAS above already gated on `checkout_run_id
        // IS NULL`). Wrapped in a best-effort try to keep the new path
        // non-blocking for step 3 — the observability pass in step 4/5
        // surfaces any divergence.
        writeCheckoutLease(getDb(), taskId, runId, ts);
      }
      return result.changes > 0;
    },

    releaseTaskLock(taskId: string, runId: string): void {
      const ts = nowIso();
       
      getDb()
        .prepare(
          "UPDATE tasks SET checkout_run_id = NULL, execution_locked_at = NULL, updated_at = ? WHERE id = ? AND checkout_run_id = ?",
        )
        .run(ts, taskId, runId);
      // B2 Phase 1 step 3/5 — dual-write: drop the shadow lease too.
      getDb()
        .prepare("DELETE FROM task_leases WHERE task_id = ? AND run_id = ?")
        .run(taskId, runId);
    },

    renewTaskLease(taskId: string, runId: string): boolean {
      const ts = nowIso();
       
      const result = getDb()
        .prepare(
          "UPDATE tasks SET execution_locked_at = ?, updated_at = ? WHERE id = ? AND checkout_run_id = ?",
        )
        .run(ts, ts, taskId, runId);
      if (result.changes > 0) {
        // Shadow renewal: push `expires_at` forward in lockstep with
        // `execution_locked_at` so the stale-lock sweep over the new
        // table stays consistent with the legacy sweep.
        const expiresAt = new Date(Date.now() + DUAL_WRITE_LEASE_TTL_MS).toISOString();
        getDb()
          .prepare(
            `UPDATE task_leases SET expires_at = ? WHERE task_id = ? AND run_id = ?`,
          )
          .run(expiresAt, taskId, runId);
      }
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
        // eslint-disable-next-line no-restricted-syntax -- B2 Phase 1 grandfathered: crash-recovery retry bounces task back to todo; trigger mirrors status→phase, no lease held at this point
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
        // eslint-disable-next-line no-restricted-syntax -- B2 Phase 1 grandfathered: crash-recovery terminal transition; trigger mirrors status→phase, lease was already cleared by interruptStaleRuns
        .prepare("update tasks set status = 'cancelled', updated_at = ? where id = ?")
        .run(ts, taskId);
    },
  };
}
