import type { DatabaseSync } from "node:sqlite";
import { currentProviderUsageWindow, isTransientProviderFailure } from "../../shared/provider-runtime-domain";
import { createId } from "../../shared/ids";
import type { ProviderCooldowns } from "./provider-cooldowns";
import { assertExecutionApproval, createIsolationContext, loadWorkspace, requireAgentProvider, requireAssignedAgent, requireTask } from "./task-run-preparation";

const TASK_RETRY_BUDGET = 3;

/** Enqueues follow-up runs for open tasks each worker tick. */
export class HeartbeatScheduler {
  /** Providers currently parked on their monthly quota, for transition logging. */
  private quotaBlockedProviders = new Map<string, string>();
  /** Tasks already logged as budget-spent, so the park is announced once, not every 5s tick. */
  private spentTasksLogged = new Set<string>();

  constructor(private readonly db: DatabaseSync, private readonly cooldowns: ProviderCooldowns) {}

  /**
   * Heartbeat: keeps every open assigned task of a heartbeat-enabled agent
   * moving. A task is enqueued whenever it has no run in flight and its
   * status is still open — a completed run that left the task open gets a
   * follow-up session (the prompt carries the prior-run count), because a
   * task is finished when it reaches done, not when a run happens to end.
   * The retry budget bounds this: at most TASK_RETRY_BUDGET non-transient
   * runs per task, then it parks for a human or manager to intervene.
   *
   * Three rules keep the loop self-healing when a provider stops serving:
   * tasks on a provider over its monthly window are parked (not enqueued into
   * certain failure), tasks on a provider inside a transient-failure cooldown
   * wait it out, and transient failures (usage/rate limits, overload) never
   * count toward the retry budget. Raising a limit — or the provider's own
   * window resetting — therefore resumes work without a restart.
   */
  enqueueHeartbeatRuns(): string[] {
    const window = currentProviderUsageWindow();
    const rows = this.db.prepare(`
      select t.id as task_id, t.org_id as org_id, p.id as provider_id
      from tasks t
      join agents a on a.id = t.assignee_agent_id and a.org_id = t.org_id
      join providers p on p.id = a.model_provider_id and p.org_id = t.org_id
      left join provider_usage_windows u
        on u.org_id = p.org_id and u.provider_id = p.id and u.window_start = ?
      where t.status in ('backlog', 'in_progress')
        and a.heartbeat_enabled = 1
        and a.lifecycle = 'active'
        and p.enabled = 1
        and coalesce(u.request_count, 0) < p.monthly_request_limit
        and not exists (select 1 from task_runs r where r.task_id = t.id and r.state in ('queued', 'running'))
        and not exists (select 1 from tasks c where c.parent_task_id = t.id and c.status <> 'done')
    `).all(window.start) as Array<{ task_id: string; org_id: string; provider_id: string }>;
    this.observeQuotaBlocks(window.start);
    const cooling = new Set(this.cooldowns.cooledProviderIds());
    const attemptMessages = this.db.prepare("select error_message from task_runs where task_id = ? and state <> 'superseded'");
    const created: string[] = [];
    for (const row of rows) {
      if (cooling.has(row.provider_id)) continue;
      const attempts = (attemptMessages.all(row.task_id) as Array<{ error_message: string | null }>)
        .filter((run) => !isTransientProviderFailure(run.error_message)).length;
      if (attempts >= TASK_RETRY_BUDGET) {
        this.observeSpentTask(row.task_id);
        continue;
      }
      try {
        created.push(this.enqueueRun(row.org_id, row.task_id));
      } catch {
        // Skip tasks that cannot be prepared yet (e.g. provider not fully configured).
      }
    }
    return created;
  }

  /**
   * A task that spent its whole retry budget without reaching done parks
   * silently otherwise — one log line makes the stall diagnosable from the
   * main-process log instead of looking like an idle queue.
   */
  private observeSpentTask(taskId: string): void {
    if (this.spentTasksLogged.has(taskId)) return;
    this.spentTasksLogged.add(taskId);
    const task = this.db.prepare("select title from tasks where id = ?").get(taskId) as { title: string } | undefined;
    console.warn(`[task-queue] task "${task?.title ?? taskId}" spent its ${TASK_RETRY_BUDGET}-run budget without reaching done; it stays parked until someone closes or reassigns it.`);
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
    const now = new Date().toISOString();
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
