import type { DatabaseSync } from "node:sqlite";
import { currentProviderUsageWindow } from "../../shared/provider-runtime-domain";
import { createId } from "../../shared/ids";
import type { ProviderCooldowns } from "./provider-cooldowns";
import { assertExecutionApproval, createIsolationContext, loadWorkspace, requireAgentProvider, requireAssignedAgent, requireTask } from "./task-run-preparation";
import { AuditService } from "./audit-service";
import { budgetBlock, isPriced, providerPrices } from "./spend";

/** Sessions that made no progress before a task stalls. */
const TASK_RETRY_BUDGET = 3;
/** Sessions of any kind before a task stalls, so endless busywork still stops. */
const TASK_SESSION_CEILING = 12;

/** Enqueues follow-up runs for open tasks each worker tick. */
export class HeartbeatScheduler {
  /** Providers currently parked on their monthly quota, for transition logging. */
  private quotaBlockedProviders = new Map<string, string>();
  /** Agents parked on a spent monthly budget, for log-once. */
  private readonly budgetParkedAgents = new Set<string>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly cooldowns: ProviderCooldowns,
    private readonly now: () => number,
    private readonly notifyDataChanged: () => void,
  ) {}

  /** Queues the next session of open work; stalls a task after sessions without progress or too many in all; transient provider failures never count. */
  enqueueHeartbeatRuns(): string[] {
    const window = currentProviderUsageWindow();
    const nowIso = new Date(this.now()).toISOString();
    // An agent's heartbeat interval paces it: one heartbeat run per interval, its most important task first.
    const rows = this.db.prepare(`
      select t.id as task_id, t.org_id as org_id, p.id as provider_id, a.id as agent_id, a.heartbeat_interval_sec as interval_sec
      from tasks t
      join agents a on a.id = t.assignee_agent_id and a.org_id = t.org_id
      join providers p on p.id = a.model_provider_id and p.org_id = t.org_id
      left join provider_usage_windows u
        on u.org_id = p.org_id and u.provider_id = p.id and u.window_start = ?
      where t.status in ('backlog', 'in_progress')
        and t.blocked_reason is null
        and a.heartbeat_enabled = 1
        and a.lifecycle = 'active'
        and p.enabled = 1
        and coalesce(u.request_count, 0) < p.monthly_request_limit
        and not exists (select 1 from task_runs r where r.task_id = t.id and r.state in ('queued', 'running'))
        and not exists (select 1 from tasks c where c.parent_task_id = t.id and c.status <> 'done')
        and (t.origin is not null or t.goal_id is null or exists (select 1 from goals g where g.id = t.goal_id and g.status = 'active'))
        and (a.heartbeat_interval_sec <= 0 or not exists (
          select 1 from task_runs hb where hb.agent_id = a.id and hb.trigger = 'heartbeat' and hb.state not in ('superseded', 'stopped')
            and hb.created_at > strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-' || a.heartbeat_interval_sec || ' seconds')
        ))
      order by case t.priority when 'high' then 0 when 'normal' then 1 else 2 end, t.created_at
    `).all(window.start, nowIso) as Array<{ task_id: string; org_id: string; provider_id: string; agent_id: string; interval_sec: number }>;
    this.observeQuotaBlocks(window.start);
    const cooling = new Set(this.cooldowns.cooledProviderIds());
    const sessionsOf = this.db.prepare(`
      select r.failure_kind,
        exists (select 1 from run_actions a where a.run_id = r.id and a.result_excerpt not like 'ERROR%') as progressed
      from task_runs r join tasks t on t.id = r.task_id
      where r.task_id = ? and r.state not in ('superseded', 'stopped', 'queued', 'running') and r.rowid > t.run_budget_floor
    `);
    const created: string[] = [];
    const pacedAgents = new Set<string>();
    for (const row of rows) {
      if (cooling.has(row.provider_id)) continue;
      if (row.interval_sec > 0 && pacedAgents.has(row.agent_id)) continue;
      const overBudget = budgetBlock(this.db, row.agent_id, isPriced(providerPrices(this.db, row.provider_id)), new Date(this.now()));
      if (overBudget) {
        if (!this.budgetParkedAgents.has(row.agent_id)) console.info(`[task-queue] ${overBudget} Its work waits.`);
        this.budgetParkedAgents.add(row.agent_id);
        continue;
      }
      this.budgetParkedAgents.delete(row.agent_id);
      const sessions = (sessionsOf.all(row.task_id) as Array<{ failure_kind: string | null; progressed: number }>)
        .filter((run) => run.failure_kind !== "transient");
      const stuck = sessions.filter((run) => run.progressed === 0).length;
      if (stuck >= TASK_RETRY_BUDGET) {
        this.markStalled(row.org_id, row.task_id, `${TASK_RETRY_BUDGET} sessions made no progress`);
        continue;
      }
      if (sessions.length >= TASK_SESSION_CEILING) {
        this.markStalled(row.org_id, row.task_id, `${TASK_SESSION_CEILING} sessions ran without reaching done`);
        continue;
      }
      try {
        created.push(this.enqueueRun(row.org_id, row.task_id));
        pacedAgents.add(row.agent_id);
        this.db.prepare("update tasks set enqueue_error = null where id = ? and enqueue_error is not null").run(row.task_id);
      } catch (error) {
        // A task that cannot be prepared yet (approval pending, setup missing) stays open; its task shows why until it queues.
        this.recordEnqueueError(row.task_id, error instanceof Error ? error.message : String(error));
      }
    }
    return created;
  }

  /** Records on the task why it could not be queued, logging and notifying only when the reason changes. */
  private recordEnqueueError(taskId: string, message: string): void {
    const changed = this.db.prepare("update tasks set enqueue_error = ? where id = ? and enqueue_error is not ?").run(message, taskId, message);
    if (changed.changes === 0) return;
    console.warn(`[task-queue] task ${taskId} could not be queued: ${message}`);
    this.notifyDataChanged();
  }

  /** Records once, on the task itself, that it spent its run budget without reaching done. */
  private markStalled(orgId: string, taskId: string, why: string): void {
    const reason = `Stalled: ${why}. Edit, reassign or reopen the task to give it a fresh budget.`;
    const marked = this.db.prepare("update tasks set stalled_reason = ? where id = ? and stalled_reason is null").run(reason, taskId);
    if (marked.changes === 0) return;
    const task = this.db.prepare("select title from tasks where id = ?").get(taskId) as { title: string };
    console.warn(`[task-queue] task "${task.title}" ${reason}`);
    new AuditService(this.db).record({ orgId, entityType: "task", entityId: taskId, actorType: "system", actorId: null, action: "stalled", payload: { reason } });
    this.notifyDataChanged();
  }

  /**
   * Logs monthly-quota transitions (blocked <-> unblocked) exactly once per
   * state change so a parked queue is diagnosable from the main-process log
   * without spamming a line every 5s tick.
   */
  private observeQuotaBlocks(windowStart: string): void {
    const rows = this.db.prepare(`
      select p.id as id, p.label as label
      from providers p
      join provider_usage_windows u
        on u.org_id = p.org_id and u.provider_id = p.id and u.window_start = ?
      where p.enabled = 1 and u.request_count >= p.monthly_request_limit
    `).all(windowStart) as Array<{ id: string; label: string }>;
    const current = new Map(rows.map((row) => [row.id, row.label]));
    for (const [id, label] of current) {
      if (!this.quotaBlockedProviders.has(id)) {
        console.warn(`[task-queue] provider "${label}" hit its monthly request limit; its tasks are parked until the limit is raised or the window resets.`);
      }
    }
    for (const [id, label] of this.quotaBlockedProviders) {
      if (!current.has(id)) {
        console.info(`[task-queue] provider "${label}" is under its monthly request limit again; parked tasks resume.`);
      }
    }
    this.quotaBlockedProviders = current;
  }

  private enqueueRun(orgId: string, taskId: string): string {
    const task = requireTask(this.db, orgId, taskId);
    // Autonomous execution honours the same gate as a manual run: a high-risk or
    // filesystem task whose approval is still pending (or was declined) is left
    // unqueued and retried once the operator approves it, instead of running
    // unsupervised. enqueueHeartbeatRuns swallows the throw and moves on.
    assertExecutionApproval(this.db, orgId, task);
    const agent = requireAssignedAgent(this.db, orgId, task);
    const provider = requireAgentProvider(this.db, orgId, agent);
    const workspace = loadWorkspace(this.db, task.workspace_id);
    const isolation = createIsolationContext(this.db, orgId, task, agent, provider, workspace);
    const runId = createId("run");
    const now = new Date(this.now()).toISOString();
    this.db.prepare(`
      insert into task_runs(
        id, org_id, task_id, agent_id, provider_id, provider_request_id,
        execution_context_id, service_identity_id, workspace_mount_json, secret_scope_json,
        trigger, state, created_at, started_at, completed_at, error_message
      ) values (?, ?, ?, ?, ?, null, ?, ?, ?, ?, 'heartbeat', ?, ?, null, null, null)
    `).run(
      runId,
      orgId,
      task.id,
      agent.id,
      provider.id,
      isolation.executionContextId,
      isolation.serviceIdentityId,
      isolation.workspaceMountJson,
      isolation.secretScopeJson,
      "queued",
      now,
    );
    return runId;
  }
}
