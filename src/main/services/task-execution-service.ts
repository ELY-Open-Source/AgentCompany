import type { DatabaseSync } from "node:sqlite";
import type { RunTaskInput } from "../../shared/commands";
import { TASK_STATUS } from "../../shared/domain";
import { isTransientProviderFailure } from "../../shared/provider-runtime-domain";
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
import { assertExecutionApproval, createIsolationContext, loadGoal, loadProject, loadWorkspace, requireAgentProvider, requireAssignedAgent, requireTask } from "./task-run-preparation";

const TASK_RUN_STATE = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
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
  ) {
    this.audit = new AuditService(db);
    this.organization = new OrganizationService(db);
    this.chat = new ChatService(db);
    this.cooldowns = new ProviderCooldowns(now);
    this.heartbeat = new HeartbeatScheduler(db, this.cooldowns);
  }

  async runTask(input: RunTaskInput): Promise<string> {
    const task = requireTask(this.db, input.orgId, input.taskId);
    assertExecutionApproval(this.db, input.orgId, task);
    const agent = requireAssignedAgent(this.db, input.orgId, task);
    const provider = requireAgentProvider(this.db, input.orgId, agent);
    const workspace = loadWorkspace(this.db, task.workspace_id);
    const isolation = createIsolationContext(this.db, input.orgId, task, agent, provider, workspace);
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
      const task = requireTask(this.db, orgId, run.task_id);
      if (task.assignee_agent_id !== run.agent_id) {
        throw new Error(`Task was reassigned after this run was queued (run agent ${run.agent_id}, assignee ${task.assignee_agent_id ?? "none"}).`);
      }
      const agent = requireAssignedAgent(this.db, orgId, task);
      const provider = requireAgentProvider(this.db, orgId, agent);
      const workspace = loadWorkspace(this.db, task.workspace_id);
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
      const task = this.db.prepare("select title, origin from tasks where id = ?").get(run.task_id) as { title: string; origin: string | null } | undefined;
      if (task && task.origin === null) recordRunMemory(this.db, { orgId, runId, taskTitle: task.title, outcome: "failed", text: message });
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
      skillRuntimeSnapshot = this.resolveSkillRuntimeSnapshot(orgId, agent.id, runId, skillBudgetTokens(provider.context_window_tokens), `${task.title}\n${task.description}`);
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
            knowledgeLines: relevantKnowledgeLines(this.db, orgId, `${task.title}\n${task.description}`),
            priorCompletedRuns: this.completedRunCount(task.id, runId),
          }),
          toolContext,
          externalTools,
          onModelTurn: contextRecorder.commit,
          inputBudgetTokens: inputBudgetTokens(provider.context_window_tokens),
          pollNewMessages: createRunMessagePoller(this.db, { orgId, onInjected: contextRecorder.addMidRun, agentId: agent.id, sourceThreadId: chatContext?.threadId ?? null, runStartedAt }),
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
      this.cooldowns.clear(provider);
      if (task.origin === null) recordRunMemory(this.db, { orgId, runId, taskTitle: task.title, outcome: "completed", text: result.finalText });
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
      if (isTransientProviderFailure(message)) this.cooldowns.park(provider, message);
      else if (task.origin === null) recordRunMemory(this.db, { orgId, runId, taskTitle: task.title, outcome: "failed", text: message });
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

  private resolveSkillRuntimeSnapshot(orgId: string, agentId: string, runId: string, maxTokens: number, taskText: string): SkillRuntimeSnapshotRow | null {
    if (!this.skills.hasRuntimeSkills(orgId, agentId)) return null;
    const snapshotId = this.skills.resolveRuntimeSnapshot({ orgId, agentId, runId, maxTokens, taskText });
    const snapshot = this.db.prepare(`
      select id, compiled_prompt, tools_manifest, source_revision_ids
      from skill_runtime_snapshots
      where id = ? and agent_id = ? and run_id = ?
    `).get(snapshotId, agentId, runId) as SkillRuntimeSnapshotRow | undefined;
    if (!snapshot) throw new Error("Skill runtime snapshot was not found.");
    return snapshot;
  }


}
