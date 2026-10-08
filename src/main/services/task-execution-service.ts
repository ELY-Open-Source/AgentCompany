import type { DatabaseSync } from "node:sqlite";
import type { RunTaskInput } from "../../shared/commands";
import { APPROVAL_STATE, RISK_LEVEL, TASK_STATUS } from "../../shared/domain";
import { currentProviderUsageWindow, isTransientProviderFailure } from "../../shared/provider-runtime-domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { ProviderService } from "./provider-service";
import { OrganizationService } from "./organization-service";
import { ChatService } from "./chat-service";
import { deliverChatReplyIfMissing } from "./chat-agent-wake-service";
import { SkillService } from "./skill-service";
import { runAgentLoop } from "./agent-run-loop";
import type { AgentToolContext } from "./agent-tools";
import {
  buildAgentInstructions,
  buildTaskPrompt,
  type GoalRow,
  type ProjectRow,
  type SkillRuntimeSnapshotRow,
  type TaskExecutionAgentRow,
  type TaskExecutionProviderRow,
  type TaskExecutionTaskRow,
  type TaskRunIsolation,
  type WorkspaceRow,
} from "./task-prompts";
import { renderTaskHandoff } from "./agent-task-handoff";
import { createRunMessagePoller, loadChatWakeContext } from "./chat-wake-context";
import { loadComposioTools } from "./composio/composio-tool-bridge";
import { connectorDisplayName } from "./composio/connector-brands";
import { ConnectorGrantsService } from "./composio/connector-grants";

const TASK_RUN_STATE = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

const TASK_RETRY_BUDGET = 3;

/**
 * How long a provider's tasks stay parked after it reports a transient
 * failure (usage limit, rate limit, overload). Long enough not to hammer a
 * closed door every 5s tick, short enough to probe again the same hour.
 */
const PROVIDER_TRANSIENT_FAILURE_COOLDOWN_MS = 10 * 60_000;

interface TaskApprovalRow {
  id: string;
  state: string;
}

interface RunRow {
  task_id: string;
  agent_id: string;
  provider_id: string;
  execution_context_id: string;
  service_identity_id: string;
  workspace_mount_json: string;
  secret_scope_json: string;
}

export class TaskExecutionService {
  private readonly audit: AuditService;
  private readonly organization: OrganizationService;
  private readonly chat: ChatService;
  /** Providers currently parked on their monthly quota, for transition logging. */
  private quotaBlockedProviders = new Map<string, string>();
  /** Providers parked after a transient failure (usage/rate limit, overload): id -> park state. */
  private providerCooldowns = new Map<string, { until: number; label: string; interactiveProbedAt?: number }>();
  /** Tasks already logged as budget-spent, so the park is announced once, not every 5s tick. */
  private spentTasksLogged = new Set<string>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly providers: ProviderService = new ProviderService(db),
    private readonly skills: SkillService = new SkillService(db, ""),
    /** Invoked whenever a run writes data mid-flight, so the UI can refresh while agents work. */
    private readonly notifyDataChanged: () => void = () => undefined,
    /** Injectable clock so tests can walk providers out of cooldown. */
    private readonly now: () => number = () => Date.now(),
  ) {
    this.audit = new AuditService(db);
    this.organization = new OrganizationService(db);
    this.chat = new ChatService(db);
  }

  async runTask(input: RunTaskInput): Promise<string> {
    const task = this.requireTask(input.orgId, input.taskId);
    this.assertExecutionApproval(input.orgId, task);
    const agent = this.requireAssignedAgent(input.orgId, task);
    const provider = this.requireAgentProvider(input.orgId, agent);
    const workspace = this.workspace(task.workspace_id);
    const isolation = this.createIsolationContext(input.orgId, task, agent, provider, workspace);
    const runId = this.createRun(input.orgId, task.id, agent.id, provider.id, isolation);
    return this.executeAgentRun({ orgId: input.orgId, runId, task, agent, provider, workspace, isolation });
  }

  /**
   * Executes an existing `running` task_run (claimed by the autonomous queue
   * worker). System-initiated, so it does not re-gate on the manual execution
   * approval — the operator configured the company to run autonomously.
   */
  async executeRun(orgId: string, runId: string): Promise<string> {
    const run = this.db.prepare(`
      select task_id, agent_id, provider_id, execution_context_id, service_identity_id, workspace_mount_json, secret_scope_json
      from task_runs where id = ? and org_id = ?
    `).get(runId, orgId) as RunRow | undefined;
    if (!run) throw new Error("Task run was not found.");
    let prepared: Parameters<TaskExecutionService["executeAgentRun"]>[0];
    try {
      const task = this.requireTask(orgId, run.task_id);
      if (task.assignee_agent_id !== run.agent_id) {
        throw new Error(`Task was reassigned after this run was queued (run agent ${run.agent_id}, assignee ${task.assignee_agent_id ?? "none"}).`);
      }
      const agent = this.requireAssignedAgent(orgId, task);
      const provider = this.requireAgentProvider(orgId, agent);
      const workspace = this.workspace(task.workspace_id);
      const isolation: TaskRunIsolation = {
        executionContextId: run.execution_context_id,
        serviceIdentityId: run.service_identity_id,
        workspaceMountJson: run.workspace_mount_json,
        secretScopeJson: run.secret_scope_json,
      };
      prepared = { orgId, runId, task, agent, provider, workspace, isolation };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[task-run] run ${runId} failed before execution: ${message}`);
      this.failRun(orgId, runId, null, message);
      this.audit.record({
        orgId,
        entityType: "task_run",
        entityId: runId,
        actorType: "system",
        actorId: null,
        action: "failed",
        payload: { taskId: run.task_id, agentId: run.agent_id, providerId: run.provider_id, stage: "preparation", errorMessage: message },
      });
      throw error;
    }
    return this.executeAgentRun(prepared);
  }

  private async executeAgentRun(args: {
    orgId: string;
    runId: string;
    task: TaskExecutionTaskRow;
    agent: TaskExecutionAgentRow;
    provider: TaskExecutionProviderRow;
    workspace: WorkspaceRow | null;
    isolation: TaskRunIsolation;
  }): Promise<string> {
    const { orgId, runId, task, agent, provider, workspace, isolation } = args;
    let providerRequestId: string | null = null;
    let skillRuntimeSnapshot: SkillRuntimeSnapshotRow | null = null;
    try {
      skillRuntimeSnapshot = this.resolveSkillRuntimeSnapshot(orgId, agent.id, runId);
      // Watermark for reply delivery and mid-run message polling.
      const runStartedAt = new Date().toISOString();
      const chatContext = loadChatWakeContext(this.db, orgId, agent.id, isolation.secretScopeJson);
      const toolContext: AgentToolContext = {
        orgId,
        agent: { id: agent.id, modelProviderId: agent.model_provider_id, modelId: agent.model_id },
        taskProjectId: task.project_id,
        taskGoalId: task.goal_id,
        taskId: task.id,
        sourceThreadId: chatContext?.threadId ?? null,
        workspace: workspace ? { id: workspace.id, localPath: workspace.local_path, writeAccess: task.requires_filesystem === 1 } : null,
      };
      // The CEO is the c_suite role — the same predicate the grant system
      // enforces — not "has no manager", which any board hire can match.
      const isCeo = agent.role_level === "c_suite";
      const hasReports = this.agentHasReports(orgId, agent.id);
      const connectorNames = new ConnectorGrantsService(this.db)
        .toolkitsForAgent(orgId, agent.id)
        .map(connectorDisplayName);
      const language = this.appLanguage();
      const externalTools = await loadComposioTools(this.db, this.providers.integrationKeys, orgId, agent.id);
      const result = await runAgentLoop(
        {
          providers: this.providers,
          tools: { db: this.db, organization: this.organization, chat: this.chat },
          onToolResults: this.notifyDataChanged,
        },
        {
          orgId,
          providerId: provider.id,
          workspaceId: task.workspace_id,
          instructions: buildAgentInstructions({ agent, companyName: this.orgName(orgId), isCeo, hasReports, connectorNames, language }),
          initialUserTurn: buildTaskPrompt({
            task,
            agent,
            provider,
            project: this.project(task.project_id),
            goal: this.goal(task.goal_id),
            workspace,
            isolation,
            skillRuntimeSnapshot,
            isManager: isCeo,
            hasReports,
            managerName: this.agentName(orgId, agent.manager_agent_id),
            chatContext,
            handoffLines: renderTaskHandoff(this.db, orgId, task.handoff_json),
            priorCompletedRuns: this.completedRunCount(task.id, runId),
          }),
          toolContext,
          externalTools,
          pollNewMessages: createRunMessagePoller(this.db, { orgId, agentId: agent.id, sourceThreadId: chatContext?.threadId ?? null, runStartedAt }),
        },
      );
      providerRequestId = result.lastRequestId;
      // A chat wake's deliverable is the visible reply. If the model answered
      // in plain text instead of calling send_message, deliver that text into
      // the source thread BEFORE the run may complete — a delivery failure
      // fails the run rather than closing it on silence.
      if (chatContext) {
        const delivered = deliverChatReplyIfMissing(this.db, this.chat, {
          orgId,
          agentId: agent.id,
          spaceId: chatContext.spaceId,
          threadId: chatContext.threadId,
          finalText: result.finalText,
          runStartedAt,
        });
        if (delivered) this.notifyDataChanged();
      }
      this.completeRun(orgId, runId, result.lastRequestId);
      this.clearProviderCooldown(provider);
      this.audit.record({
        orgId,
        entityType: "task_run",
        entityId: runId,
        actorType: "system",
        actorId: null,
        action: "completed",
        payload: {
          taskId: task.id,
          agentId: agent.id,
          providerId: provider.id,
          providerRequestId: result.lastRequestId,
          iterations: result.iterations,
          toolCalls: result.toolCallCount,
          executionContextId: isolation.executionContextId,
          serviceIdentityId: isolation.serviceIdentityId,
          skillRuntimeSnapshotId: skillRuntimeSnapshot?.id ?? null,
        },
      });
      return runId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failRun(orgId, runId, providerRequestId, message);
      if (isTransientProviderFailure(message)) this.parkProvider(provider, message);
      this.audit.record({
        orgId,
        entityType: "task_run",
        entityId: runId,
        actorType: "system",
        actorId: null,
        action: "failed",
        payload: {
          taskId: task.id,
          agentId: agent.id,
          providerId: provider.id,
          providerRequestId,
          executionContextId: isolation.executionContextId,
          serviceIdentityId: isolation.serviceIdentityId,
          skillRuntimeSnapshotId: skillRuntimeSnapshot?.id ?? null,
          errorMessage: message,
        },
      });
      throw error;
    }
  }

  private requireTask(orgId: string, taskId: string): TaskExecutionTaskRow {
    const task = this.db.prepare("select * from tasks where id = ? and org_id = ?").get(taskId, orgId) as TaskExecutionTaskRow | undefined;
    if (!task) throw new Error("Task was not found.");
    return task;
  }

  private requireAssignedAgent(orgId: string, task: TaskExecutionTaskRow): TaskExecutionAgentRow {
    if (!task.assignee_agent_id) throw new Error("Task requires an assigned agent.");
    const agent = this.db.prepare(`
      select id, name, role, department, title, role_level, model_provider_id, model_id, manager_agent_id
      from agents
      where id = ? and org_id = ?
    `).get(task.assignee_agent_id, orgId) as TaskExecutionAgentRow | undefined;
    if (!agent) throw new Error("Task assignee was not found.");
    return agent;
  }

  private assertExecutionApproval(orgId: string, task: TaskExecutionTaskRow): void {
    if (task.risk !== RISK_LEVEL.HIGH && task.requires_filesystem !== 1) return;
    const approval = this.db.prepare(`
      select id, state
      from approvals
      where org_id = ?
        and source_entity_type = 'task'
        and source_entity_id = ?
        and kind in ('task_risk', 'task_execution')
      order by created_at desc
      limit 1
    `).get(orgId, task.id) as TaskApprovalRow | undefined;
    if (!approval || approval.state !== APPROVAL_STATE.APPROVED) {
      throw new Error("Approved task execution approval is required.");
    }
  }

  private requireAgentProvider(orgId: string, agent: TaskExecutionAgentRow): TaskExecutionProviderRow {
    if (!agent.model_provider_id) throw new Error("Task assignee requires a model provider.");
    const provider = this.db.prepare(`
      select id, label, provider_key, model
      from providers
      where id = ? and org_id = ?
    `).get(agent.model_provider_id, orgId) as TaskExecutionProviderRow | undefined;
    if (!provider) throw new Error("Task assignee provider was not found.");
    return provider;
  }

  private createRun(orgId: string, taskId: string, agentId: string, providerId: string, isolation: TaskRunIsolation): string {
    const busy = this.db.prepare("select t.title from task_runs r join tasks t on t.id = r.task_id where r.agent_id = ? and r.state = 'running' limit 1")
      .get(agentId) as { title: string } | undefined;
    if (busy) throw new Error(`This agent is already working on "${busy.title}"; run again when that session ends.`);
    const runId = createId("run");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into task_runs(
        id, org_id, task_id, agent_id, provider_id, provider_request_id,
        execution_context_id, service_identity_id, workspace_mount_json, secret_scope_json,
        trigger, state, created_at, started_at, completed_at, error_message
      ) values (?, ?, ?, ?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, null, null)
    `).run(
      runId,
      orgId,
      taskId,
      agentId,
      providerId,
      isolation.executionContextId,
      isolation.serviceIdentityId,
      isolation.workspaceMountJson,
      isolation.secretScopeJson,
      "manual",
      TASK_RUN_STATE.RUNNING,
      now,
      now,
    );
    this.audit.record({
      orgId,
      entityType: "task_run",
      entityId: runId,
      actorType: "system",
      actorId: null,
      action: "started",
      payload: { taskId, agentId, providerId, trigger: "manual", executionContextId: isolation.executionContextId, serviceIdentityId: isolation.serviceIdentityId },
    });
    return runId;
  }

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
    `).all(window.start) as Array<{ task_id: string; org_id: string; provider_id: string }>;
    this.observeQuotaBlocks(window.start);
    const cooling = new Set(this.cooledProviderIds());
    const attemptMessages = this.db.prepare("select error_message from task_runs where task_id = ?");
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
   * Parks a provider after it reported a transient failure (usage limit, rate
   * limit, overload), so the queue stops feeding it doomed runs every tick.
   * The park is in-memory by design: after a restart the first probe run
   * either succeeds or re-arms the cooldown at the cost of one request.
   */
  private parkProvider(provider: TaskExecutionProviderRow, message: string): void {
    const active = this.providerCooldowns.get(provider.id);
    const wasParked = active !== undefined && active.until > this.now();
    this.providerCooldowns.set(provider.id, {
      until: this.now() + PROVIDER_TRANSIENT_FAILURE_COOLDOWN_MS,
      label: provider.label,
      // A failed probe must not unlock endless probes: re-arming the park
      // keeps the spent-probe mark until the window expires naturally.
      interactiveProbedAt: wasParked ? active?.interactiveProbedAt : undefined,
    });
    if (!wasParked) {
      const minutes = Math.round(PROVIDER_TRANSIENT_FAILURE_COOLDOWN_MS / 60_000);
      console.warn(`[task-queue] provider "${provider.label}" reported a transient failure ("${message}"); its tasks are parked for ${minutes} minutes.`);
    }
  }

  /**
   * Providers currently inside a transient-failure cooldown. Expired parks are
   * pruned (with a resume log line) so the next tick probes the provider again.
   */
  cooledProviderIds(): string[] {
    const active: string[] = [];
    for (const [id, park] of this.providerCooldowns) {
      if (park.until > this.now()) {
        active.push(id);
      } else {
        this.providerCooldowns.delete(id);
        console.info(`[task-queue] provider "${park.label}" cooldown ended; its tasks resume.`);
      }
    }
    return active;
  }

  /**
   * Cooled providers that even the interactive lane must skip: their one
   * founder-probe for this park window is already spent. A cooled provider
   * not yet probed stays interactively claimable — one human message is
   * allowed through to learn whether the outage was a blip, instead of the
   * founder sitting out the whole cooldown for a single failed background
   * request.
   */
  interactiveCooledProviderIds(): string[] {
    return this.cooledProviderIds().filter((id) => this.providerCooldowns.get(id)?.interactiveProbedAt !== undefined);
  }

  /** Marks the cooled provider's founder-probe as spent (no-op when healthy). */
  noteInteractiveProbe(providerId: string): void {
    const park = this.providerCooldowns.get(providerId);
    if (park) park.interactiveProbedAt = this.now();
  }

  /** A served request is proof of health: the park ends for everyone at once. */
  private clearProviderCooldown(provider: TaskExecutionProviderRow): void {
    if (this.providerCooldowns.delete(provider.id)) {
      console.info(`[task-queue] provider "${provider.label}" served a request; cooldown lifted early.`);
    }
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
    const task = this.requireTask(orgId, taskId);
    // Autonomous execution honours the same gate as a manual run: a high-risk or
    // filesystem task whose approval is still pending (or was declined) is left
    // unqueued and retried once the operator approves it, instead of running
    // unsupervised. enqueueHeartbeatRuns swallows the throw and moves on.
    this.assertExecutionApproval(orgId, task);
    const agent = this.requireAssignedAgent(orgId, task);
    const provider = this.requireAgentProvider(orgId, agent);
    const workspace = this.workspace(task.workspace_id);
    const isolation = this.createIsolationContext(orgId, task, agent, provider, workspace);
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
      TASK_RUN_STATE.QUEUED,
      now,
    );
    return runId;
  }

  private completedRunCount(taskId: string, excludingRunId: string): number {
    const row = this.db.prepare("select count(*) as n from task_runs where task_id = ? and state = 'completed' and id <> ?")
      .get(taskId, excludingRunId) as { n: number };
    return row.n;
  }

  private agentHasReports(orgId: string, agentId: string): boolean {
    const row = this.db.prepare("select 1 from agents where org_id = ? and manager_agent_id = ? and lifecycle = 'active' limit 1")
      .get(orgId, agentId);
    return Boolean(row);
  }

  private agentName(orgId: string, agentId: string | null): string | null {
    if (!agentId) return null;
    const row = this.db.prepare("select name from agents where id = ? and org_id = ?").get(agentId, orgId) as { name: string } | undefined;
    return row?.name ?? null;
  }

  private orgName(orgId: string): string {
    const row = this.db.prepare("select name from organizations where id = ?").get(orgId) as { name: string } | undefined;
    if (!row) throw new Error("Organization was not found.");
    return row.name;
  }

  private appLanguage(): "en" | "zh" {
    const row = this.db.prepare("select language from app_state where id = 1").get() as { language: string } | undefined;
    return row?.language === "zh" ? "zh" : "en";
  }

  private completeRun(orgId: string, runId: string, providerRequestId: string): void {
    this.db.prepare(`
      update task_runs
      set state = ?, provider_request_id = ?, completed_at = ?, error_message = null
      where id = ? and org_id = ?
    `).run(TASK_RUN_STATE.COMPLETED, providerRequestId, new Date().toISOString(), runId, orgId);
    this.closeChatWakeTask(orgId, runId);
  }

  /**
   * A chat-wake task exists only to carry its reply run — the reply is the
   * whole deliverable. The run completing therefore closes the task; left
   * open it would strand forever (a task with a completed run is never
   * enqueued again) and pile zombie "Reply to ..." rows onto the board.
   */
  private closeChatWakeTask(orgId: string, runId: string): void {
    const run = this.db.prepare("select task_id, trigger from task_runs where id = ? and org_id = ?")
      .get(runId, orgId) as { task_id: string; trigger: string } | undefined;
    if (!run || run.trigger !== "chat_mention") return;
    const task = this.db.prepare("select status from tasks where id = ? and org_id = ?")
      .get(run.task_id, orgId) as { status: string } | undefined;
    if (!task || (task.status !== TASK_STATUS.BACKLOG && task.status !== TASK_STATUS.IN_PROGRESS)) return;
    this.organization.updateTaskStatus(orgId, run.task_id, TASK_STATUS.DONE);
  }

  private failRun(orgId: string, runId: string, providerRequestId: string | null, errorMessage: string): void {
    this.db.prepare(`
      update task_runs
      set state = ?, provider_request_id = coalesce(?, provider_request_id), completed_at = ?, error_message = ?
      where id = ? and org_id = ?
    `).run(TASK_RUN_STATE.FAILED, providerRequestId, new Date().toISOString(), errorMessage, runId, orgId);
  }

  private resolveSkillRuntimeSnapshot(orgId: string, agentId: string, runId: string): SkillRuntimeSnapshotRow | null {
    if (!this.skills.hasRuntimeSkills(orgId, agentId)) return null;
    const snapshotId = this.skills.resolveRuntimeSnapshot({ orgId, agentId, runId });
    const snapshot = this.db.prepare(`
      select id, compiled_prompt, tools_manifest, source_revision_ids
      from skill_runtime_snapshots
      where id = ? and agent_id = ? and run_id = ?
    `).get(snapshotId, agentId, runId) as SkillRuntimeSnapshotRow | undefined;
    if (!snapshot) throw new Error("Skill runtime snapshot was not found.");
    return snapshot;
  }

  private project(projectId: string | null): ProjectRow | null {
    if (!projectId) return null;
    return (this.db.prepare("select name, description from projects where id = ?").get(projectId) as unknown as ProjectRow | undefined) ?? null;
  }

  private goal(goalId: string | null): GoalRow | null {
    if (!goalId) return null;
    return (this.db.prepare("select title, description from goals where id = ?").get(goalId) as unknown as GoalRow | undefined) ?? null;
  }

  private workspace(workspaceId: string | null): WorkspaceRow | null {
    if (!workspaceId) return null;
    return (this.db.prepare("select id, name, local_path, repo_url, repo_ref from workspaces where id = ?").get(workspaceId) as unknown as WorkspaceRow | undefined) ?? null;
  }

  private createIsolationContext(
    orgId: string,
    task: TaskExecutionTaskRow,
    agent: TaskExecutionAgentRow,
    provider: TaskExecutionProviderRow,
    workspace: WorkspaceRow | null,
  ): TaskRunIsolation {
    if (task.requires_filesystem === 1 && !workspace) throw new Error("Filesystem tasks require a workspace.");
    const serviceIdentityId = this.requireServiceIdentity(orgId, agent.id);
    const executionContextId = createId("ctx");
    const workspaceMounts = workspace ? [{
      workspaceId: workspace.id,
      name: workspace.name,
      localPath: workspace.local_path,
      repoRef: workspace.repo_ref,
      mode: task.requires_filesystem === 1 ? "read_write" : "read_only",
    }] : [];
    return {
      executionContextId,
      serviceIdentityId,
      workspaceMountJson: JSON.stringify(workspaceMounts),
      secretScopeJson: JSON.stringify({
        serviceIdentityId,
        providerIds: [provider.id],
        scope: "task_run",
        credentialAccess: "provider_runtime_only",
      }),
    };
  }

  private requireServiceIdentity(orgId: string, agentId: string): string {
    const row = this.db.prepare("select id from service_identities where org_id = ? and agent_id = ?")
      .get(orgId, agentId) as { id: string } | undefined;
    if (!row) throw new Error("Agent service identity was not found.");
    return row.id;
  }
}
