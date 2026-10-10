import { appLanguage, taskWorkLanguage } from "./work-language";
import { closeChatWakeTask } from "./chat-wake-close";
import type { DatabaseSync } from "node:sqlite";
import type { RunTaskInput } from "../../shared/commands";
import { TASK_STATUS, WRITING_MODE, type WorkLanguage } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { ProviderService } from "./provider-service";
import { OrganizationService } from "./organization-service";
import { ChatService } from "./chat-service";
import { deliverChatReplyIfMissing } from "./chat-agent-wake-service";
import { SkillService } from "./skill-service";
import { runAgentLoop, runTools } from "./agent-run-loop";
import type { RunModel } from "./skill-runtime";
import { combineMidRunPolls, createGoalChangePoller } from "./goal-change-poller";
import { recordRunAction, unresolvedActionFailure, runJournalLines } from "./run-journal";
import { classifyProviderFailure } from "./provider-failure";
import { runStopReason, SESSION_TIME_LIMIT_MESSAGE, SESSION_TIME_LIMIT_MS, withRunControl } from "./run-control";
import type { AgentToolContext } from "./agent-tools";
import {
  buildAgentInstructions,
  buildTaskPrompt,
  type SkillRuntimeSnapshotRow,
  type TaskExecutionAgentRow,
  type TaskExecutionProviderRow,
  type TaskExecutionTaskRow,
  type TaskRunIsolation,
  type WorkspaceRow,
} from "./task-prompts";
import { renderTaskHandoff } from "./agent-task-handoff";
import { relevantKnowledgeLines } from "./agent-knowledge-tools";
import { recordRunMemory } from "./run-memory";
import { createRunContextRecorder, createRunMessagePoller, loadChatWakeContext } from "./chat-wake-context";
import { runningWorkspaceWriter } from "./workspace-write-lock";
import { inputBudgetTokens, skillBudgetTokens } from "./context-budget";
import { loadComposioTools } from "./composio/composio-tool-bridge";
import { connectorDisplayName } from "./composio/connector-brands";
import { ConnectorGrantsService } from "./composio/connector-grants";
import { ProviderCooldowns } from "./provider-cooldowns";
import { HeartbeatScheduler } from "./heartbeat-scheduler";
import {
  assertExecutionApproval, assertModelSelectable, createIsolationContext, effectiveModel, executionApprovalProblem, loadGoal, loadProject, loadWorkspace,
  requireAgentProvider, requireAssignedAgent, requireTask, sameWorkspaceAccess, workspaceAccess,
} from "./task-run-preparation";

const TASK_RUN_STATE = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SUPERSEDED: "superseded",
  STOPPED: "stopped",
} as const;



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
  private readonly cooldowns: ProviderCooldowns;
  private readonly heartbeat: HeartbeatScheduler;

  constructor(
    private readonly db: DatabaseSync,
    private readonly providers: ProviderService = new ProviderService(db),
    private readonly skills: SkillService = new SkillService(db, ""),
    /** Invoked whenever a run writes data mid-flight, so the UI can refresh while agents work. */
    private readonly notifyDataChanged: () => void = () => undefined,
    /** Injectable clock so tests can walk providers out of cooldown. */
    now: () => number = () => Date.now(),
    /** Wall-clock budget of one session. */
    private readonly sessionTimeLimitMs: number = SESSION_TIME_LIMIT_MS,
  ) {
    this.audit = new AuditService(db);
    this.organization = new OrganizationService(db);
    this.chat = new ChatService(db);
    this.cooldowns = new ProviderCooldowns(db, now);
    this.heartbeat = new HeartbeatScheduler(db, this.cooldowns, now, notifyDataChanged);
  }

  async runTask(input: RunTaskInput): Promise<string> {
    const task = requireTask(this.db, input.orgId, input.taskId);
    if (task.status === TASK_STATUS.DONE) throw new Error(`"${task.title}" is done. Reopen it before running it again.`);
    if (task.blocked_reason !== null) throw new Error(`"${task.title}" is blocked: ${task.blocked_reason} Unblock it to run it.`);
    const inFlight = this.db.prepare("select state from task_runs where task_id = ? and state in ('queued', 'running') limit 1")
      .get(task.id) as { state: string } | undefined;
    if (inFlight) {
      throw new Error(inFlight.state === "queued" ? `"${task.title}" already has a queued session; it will run shortly.` : `"${task.title}" already has a running session.`);
    }
    assertExecutionApproval(this.db, input.orgId, task);
    const agent = requireAssignedAgent(this.db, input.orgId, task);
    const provider = requireAgentProvider(this.db, input.orgId, agent);
    const workspace = loadWorkspace(this.db, task.workspace_id);
    const isolation = createIsolationContext(this.db, input.orgId, task, agent, provider, workspace);
    const runId = this.createRun(input.orgId, task.id, agent.id, provider.id, isolation);
    return withRunControl(runId, () => this.executeAgentRun({ orgId: input.orgId, runId, task, agent, provider, workspace, isolation }), this.sessionTimeLimitMs);
  }

  /** Executes a claimed run after re-checking that the task still matches it; a mismatch supersedes the run. */
  async executeRun(orgId: string, runId: string): Promise<string> {
    const run = this.db.prepare(`
      select task_id, agent_id, provider_id, execution_context_id, service_identity_id, workspace_mount_json, secret_scope_json
      from task_runs where id = ? and org_id = ?
    `).get(runId, orgId) as RunRow | undefined;
    if (!run) throw new Error("Task run was not found.");
    let prepared: Parameters<TaskExecutionService["executeAgentRun"]>[0];
    try {
      const task = requireTask(this.db, orgId, run.task_id);
      if (task.status === TASK_STATUS.DONE) return this.supersedeRun(orgId, runId, run, "the task was closed after this run was queued.");
      if (task.blocked_reason !== null) return this.supersedeRun(orgId, runId, run, `the task was blocked after this run was queued (${task.blocked_reason}).`);
      if (task.assignee_agent_id !== run.agent_id) {
        return this.supersedeRun(orgId, runId, run, `the task was reassigned after this run was queued (run agent ${run.agent_id}, assignee ${task.assignee_agent_id ?? "none"}).`);
      }
      const agent = requireAssignedAgent(this.db, orgId, task);
      const provider = requireAgentProvider(this.db, orgId, agent);
      if (provider.id !== run.provider_id) {
        return this.supersedeRun(orgId, runId, run, `the assignee's provider changed after this run was queued (${run.provider_id ?? "none"} -> ${provider.id}).`);
      }
      const workspace = loadWorkspace(this.db, task.workspace_id);
      if (!sameWorkspaceAccess(run.workspace_mount_json, workspaceAccess(task, workspace))) {
        return this.supersedeRun(orgId, runId, run, "the task's workspace access changed after this run was queued.");
      }
      const goal = task.origin === null && task.goal_id
        ? this.db.prepare("select status from goals where id = ?").get(task.goal_id) as { status: string } | undefined
        : undefined;
      if (goal && goal.status !== "active") return this.supersedeRun(orgId, runId, run, `the task's goal is ${goal.status}, so its work stops.`);
      const openSubtask = this.db.prepare("select title from tasks where parent_task_id = ? and status <> 'done' limit 1").get(task.id) as { title: string } | undefined;
      if (openSubtask) return this.supersedeRun(orgId, runId, run, `the task has open subtasks ("${openSubtask.title}"); it runs again once they are done.`);
      const approvalProblem = executionApprovalProblem(this.db, orgId, task);
      if (approvalProblem) return this.supersedeRun(orgId, runId, run, approvalProblem);
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
      this.failRun(orgId, runId, null, message, null);
      this.audit.record({
        orgId,
        entityType: "task_run",
        entityId: runId,
        actorType: "system",
        actorId: null,
        action: "failed",
        payload: { taskId: run.task_id, agentId: run.agent_id, providerId: run.provider_id, stage: "preparation", errorMessage: message },
      });
      const task = this.db.prepare("select title, origin, project_id from tasks where id = ?").get(run.task_id) as { title: string; origin: string | null; project_id: string | null } | undefined;
      if (task && task.origin === null) recordRunMemory(this.db, { orgId, runId, projectId: task.project_id, taskTitle: task.title, outcome: "failed", text: message });
      throw error;
    }
    return withRunControl(runId, () => this.executeAgentRun(prepared), this.sessionTimeLimitMs);
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
      // The session keeps the model and account it started with; a resumed run keeps its original pins.
      const pinned = (this.db.prepare("select run_model from task_runs where id = ?").get(runId) as { run_model: string | null }).run_model;
      if (pinned === null) {
        assertModelSelectable(provider.provider_key, agent.model_id, provider.model);
        this.db.prepare("update task_runs set run_model = ?, run_credential_id = ? where id = ?")
          .run(effectiveModel(agent.model_id, provider.model), provider.credential_id, runId);
      }
      const runModel = pinned ?? effectiveModel(agent.model_id, provider.model);
      const language = taskWorkLanguage(this.db, orgId, task.id);
      const chatLanguage = appLanguage(this.db);
      skillRuntimeSnapshot = this.resolveSkillRuntimeSnapshot(orgId, agent.id, runId, skillBudgetTokens(provider.context_window_tokens), `${task.title}\n${task.description}`, { providerKey: provider.provider_key, model: runModel }, task.writing_mode === WRITING_MODE.CONVERSATIONAL, task.origin === "chat_wake" ? chatLanguage : language);
      // Watermark for reply delivery and mid-run message polling.
      const runStartedAt = new Date().toISOString();
      const chatContext = loadChatWakeContext(this.db, orgId, agent.id, isolation.secretScopeJson);
      const contextRecorder = createRunContextRecorder(this.db, runId, chatContext);
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
      // Baseline taken before any await, so a goal closed while tools load still reaches the session.
      const goalChanges = createGoalChangePoller(this.db, task.goal_id);
      const externalTools = loadComposioTools(this.db, this.providers.integrationKeys, orgId, agent.id);
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
          instructions: buildAgentInstructions({ agent, companyName: this.orgName(orgId), isCeo, hasReports, connectorNames, language, chatLanguage }),
          initialUserTurn: buildTaskPrompt({
            task,
            agent,
            provider,
            project: loadProject(this.db, task.project_id),
            goal: loadGoal(this.db, task.goal_id),
            workspace,
            isolation,
            skillRuntimeSnapshot,
            isManager: isCeo,
            hasReports,
            managerName: this.agentName(orgId, agent.manager_agent_id),
            chatContext,
            handoffLines: renderTaskHandoff(this.db, orgId, task.handoff_json),
            knowledgeLines: relevantKnowledgeLines(this.db, { orgId, agentId: agent.id, projectId: task.project_id, goalId: task.goal_id, taskId: task.id }, `${task.title}\n${task.description}`),
            priorCompletedRuns: this.completedRunCount(task.id, runId),
            runModel,
            journalLines: runJournalLines(this.db, task.id),
            subtasks: (this.db.prepare("select title, status = 'done' as done from tasks where parent_task_id = ? order by created_at").all(task.id) as Array<{ title: string; done: number }>)
              .map((row) => ({ title: row.title, done: row.done === 1 })),
            availableToolNames: runTools(externalTools).map((tool) => tool.name),
          }),
          toolContext,
          externalTools,
          onModelTurn: (turn) => {
            contextRecorder.commit();
            // A served request ends the provider's failure streak, so the next park starts small again.
            this.cooldowns.clear(provider);
            // A response that says no requests remain parks the provider until its reset, before the next call fails into it.
            const limits = turn.rateLimitState;
            const resetIn = limits?.resetAt ? Date.parse(limits.resetAt) - Date.now() : 0;
            if (limits?.remainingRequests === 0 && resetIn > 0) this.cooldowns.park(provider, "no requests left until the provider's reset", resetIn);
          },
          onToolCompleted: (call, output) => recordRunAction(this.db, { orgId, runId, taskId: task.id, call, output }),
          inputBudgetTokens: inputBudgetTokens(provider.context_window_tokens),
          pollNewMessages: combineMidRunPolls(
            goalChanges,
            createRunMessagePoller(this.db, { orgId, onInjected: contextRecorder.addMidRun, agentId: agent.id, sourceThreadId: chatContext?.threadId ?? null, runStartedAt }),
          ),
        },
      );
      providerRequestId = result.lastRequestId;
      // A chat wake's deliverable is the visible reply. If the model answered
      // in plain text instead of calling send_message, deliver that text into
      // the source thread BEFORE the run may complete — a delivery failure
      // fails the run rather than closing it on silence.
      // A checkpoint is unfinished work: no stand-in reply, and a chat wake stays open for its next session.
      if (chatContext && !result.hitStepLimit) {
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
      // Real work whose writes or external actions failed and were not redone has not succeeded, whatever the model said last.
      const actionFailure = result.hitStepLimit || task.origin !== null ? null : unresolvedActionFailure(this.db, runId);
      if (actionFailure) this.failRun(orgId, runId, result.lastRequestId, actionFailure, null);
      else this.completeRun(orgId, runId, result.lastRequestId, result.hitStepLimit);
      if (task.origin === null) recordRunMemory(this.db, { orgId, runId, projectId: task.project_id, taskTitle: task.title, outcome: actionFailure ? "failed" : "completed", text: actionFailure ?? result.finalText });
      this.audit.record({
        orgId,
        entityType: "task_run",
        entityId: runId,
        actorType: "system",
        actorId: null,
        action: actionFailure ? "failed" : "completed",
        payload: {
          taskId: task.id,
          agentId: agent.id,
          providerId: provider.id,
          providerRequestId: result.lastRequestId,
          iterations: result.iterations,
          toolCalls: result.toolCallCount,
          hitStepLimit: result.hitStepLimit,
          executionContextId: isolation.executionContextId,
          serviceIdentityId: isolation.serviceIdentityId,
          skillRuntimeSnapshotId: skillRuntimeSnapshot?.id ?? null,
        },
      });
      return runId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A stop wins over whatever error the interrupted step raised.
      const stopReason = runStopReason();
      // Out of time is not a failure: the session ends as a checkpoint and the next one continues from the journal.
      if (stopReason === SESSION_TIME_LIMIT_MESSAGE) {
        this.completeRun(orgId, runId, providerRequestId, true);
        this.audit.record({ orgId, entityType: "task_run", entityId: runId, actorType: "system", actorId: null, action: "completed", payload: { taskId: task.id, agentId: agent.id, timeLimit: true } });
        return runId;
      }
      if (stopReason) {
        this.markStopped(orgId, runId, providerRequestId, stopReason, { taskId: task.id, agentId: agent.id, providerId: provider.id });
        throw new Error(stopReason);
      }
      const failure = classifyProviderFailure(error, Date.now());
      this.failRun(orgId, runId, providerRequestId, message, failure.transient ? "transient" : null);
      if (failure.transient) this.cooldowns.park(provider, message, failure.retryAfterMs);
      else if (task.origin === null) recordRunMemory(this.db, { orgId, runId, projectId: task.project_id, taskTitle: task.title, outcome: "failed", text: message });
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

  private createRun(orgId: string, taskId: string, agentId: string, providerId: string, isolation: TaskRunIsolation): string {
    const busy = this.db.prepare("select t.title from task_runs r join tasks t on t.id = r.task_id where r.agent_id = ? and r.state = 'running' limit 1")
      .get(agentId) as { title: string } | undefined;
    if (busy) throw new Error(`This agent is already working on "${busy.title}"; run again when that session ends.`);
    const writer = runningWorkspaceWriter(this.db, taskId);
    if (writer !== null) throw new Error(`"${writer.title}" is changing this workspace right now; run again when it finishes.`);
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

  cooledProviderIds(): string[] {
    return this.cooldowns.cooledProviderIds();
  }

  interactiveCooledProviderIds(): string[] {
    return this.cooldowns.interactiveCooledProviderIds();
  }

  noteInteractiveProbe(providerId: string): void {
    this.cooldowns.noteInteractiveProbe(providerId);
  }
  enqueueHeartbeatRuns(): string[] {
    return this.heartbeat.enqueueHeartbeatRuns();
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


  private completeRun(orgId: string, runId: string, providerRequestId: string | null, checkpoint: boolean): void {
    this.db.prepare(`
      update task_runs
      set state = ?, provider_request_id = coalesce(?, provider_request_id), completed_at = ?, error_message = null
      where id = ? and org_id = ?
    `).run(TASK_RUN_STATE.COMPLETED, providerRequestId, new Date().toISOString(), runId, orgId);
    if (!checkpoint) closeChatWakeTask(this.db, orgId, runId);
  }

  /** The operator stopped the run: not a failure, no retry budget spent, no memory recorded. */
  private markStopped(orgId: string, runId: string, providerRequestId: string | null, reason: string, payload: { taskId: string; agentId: string; providerId: string }): void {
    this.db.prepare(`
      update task_runs set state = ?, provider_request_id = coalesce(?, provider_request_id), completed_at = ?, error_message = ?
      where id = ? and org_id = ?
    `).run(TASK_RUN_STATE.STOPPED, providerRequestId, new Date().toISOString(), reason, runId, orgId);
    closeChatWakeTask(this.db, orgId, runId);
    this.audit.record({ orgId, entityType: "task_run", entityId: runId, actorType: "system", actorId: null, action: "stopped", payload: { ...payload, reason } });
  }

  /** Closes a queued run that no longer matches its task; it is not a failure and spends no retry budget. */
  private supersedeRun(orgId: string, runId: string, run: RunRow, reason: string): string {
    const message = `Superseded: ${reason}`;
    console.info(`[task-run] run ${runId} ${message}`);
    this.db.prepare("update task_runs set state = ?, completed_at = ?, error_message = ? where id = ? and org_id = ?")
      .run(TASK_RUN_STATE.SUPERSEDED, new Date().toISOString(), message, runId, orgId);
    closeChatWakeTask(this.db, orgId, runId);
    this.audit.record({
      orgId,
      entityType: "task_run",
      entityId: runId,
      actorType: "system",
      actorId: null,
      action: "superseded",
      payload: { taskId: run.task_id, agentId: run.agent_id, providerId: run.provider_id, reason },
    });
    return runId;
  }

  private failRun(orgId: string, runId: string, providerRequestId: string | null, errorMessage: string, failureKind: "transient" | null): void {
    this.db.prepare(`
      update task_runs
      set state = ?, provider_request_id = coalesce(?, provider_request_id), completed_at = ?, error_message = ?, failure_kind = ?
      where id = ? and org_id = ?
    `).run(TASK_RUN_STATE.FAILED, providerRequestId, new Date().toISOString(), errorMessage, failureKind, runId, orgId);
  }

  private resolveSkillRuntimeSnapshot(orgId: string, agentId: string, runId: string, maxTokens: number, taskText: string, runModel: RunModel, houseStyle: boolean, language: WorkLanguage): SkillRuntimeSnapshotRow | null {
    if (!this.skills.hasRuntimeSkills(orgId, agentId, houseStyle, language)) return null;
    const snapshotId = this.skills.resolveRuntimeSnapshot({ orgId, agentId, runId, maxTokens, taskText, runModel, houseStyle, language });
    const snapshot = this.db.prepare(`
      select id, compiled_prompt, tools_manifest, source_revision_ids
      from skill_runtime_snapshots
      where id = ? and agent_id = ? and run_id = ?
    `).get(snapshotId, agentId, runId) as SkillRuntimeSnapshotRow | undefined;
    if (!snapshot) throw new Error("Skill runtime snapshot was not found.");
    return snapshot;
  }
}
