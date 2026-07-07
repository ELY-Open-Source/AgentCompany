import type { DatabaseSync } from "node:sqlite";
import type { RunTaskInput } from "../../shared/commands";
import { APPROVAL_STATE, RISK_LEVEL } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { ProviderService } from "./provider-service";
import { OrganizationService } from "./organization-service";
import { ChatService } from "./chat-service";
import { SkillService } from "./skill-service";
import { runAgentLoop } from "./agent-run-loop";
import type { AgentToolContext } from "./agent-tools";
import {
  buildAgentInstructions,
  buildTaskPrompt,
  type ChatContextBlock,
  type InboxContextBlock,
  type GoalRow,
  type ProjectRow,
  type SkillRuntimeSnapshotRow,
  type TaskExecutionAgentRow,
  type TaskExecutionProviderRow,
  type TaskExecutionTaskRow,
  type TaskRunIsolation,
  type WorkspaceRow,
} from "./task-prompts";
import { loadComposioTools } from "./composio/composio-tool-bridge";

const TASK_RUN_STATE = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

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

  constructor(
    private readonly db: DatabaseSync,
    private readonly providers: ProviderService = new ProviderService(db),
    private readonly skills: SkillService = new SkillService(db, ""),
    /** Invoked whenever a run writes data mid-flight, so the UI can refresh while agents work. */
    private readonly notifyDataChanged: () => void = () => undefined,
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
    const task = this.requireTask(orgId, run.task_id);
    const agent = this.requireAssignedAgent(orgId, task);
    const provider = this.requireAgentProvider(orgId, agent);
    const workspace = this.workspace(task.workspace_id);
    const isolation: TaskRunIsolation = {
      executionContextId: run.execution_context_id,
      serviceIdentityId: run.service_identity_id,
      workspaceMountJson: run.workspace_mount_json,
      secretScopeJson: run.secret_scope_json,
    };
    return this.executeAgentRun({ orgId, runId, task, agent, provider, workspace, isolation });
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
      const toolContext: AgentToolContext = {
        orgId,
        agent: { id: agent.id, modelProviderId: agent.model_provider_id, modelId: agent.model_id },
        taskProjectId: task.project_id,
        taskGoalId: task.goal_id,
        workspace: workspace ? { id: workspace.id, localPath: workspace.local_path } : null,
      };
      const chatContext = this.loadChatContext(orgId, isolation);
      const inboxContext = chatContext ? null : this.loadInboxContext(orgId, agent.id);
      const isCeo = !agent.manager_agent_id;
      const hasReports = this.agentHasReports(orgId, agent.id);
      const externalTools = await loadComposioTools(this.db, orgId, agent.id);
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
          instructions: buildAgentInstructions({ agent, companyName: this.orgName(orgId), isCeo, hasReports, externalToolCount: externalTools.length }),
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
            inboxContext,
          }),
          toolContext,
          externalTools,
        },
      );
      providerRequestId = result.lastRequestId;
      this.completeRun(orgId, runId, result.lastRequestId);
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
   * Heartbeat: enqueues one run per actionable assigned task of a
   * heartbeat-enabled agent with an enabled provider that has not run yet, so
   * CEO-delegated work starts on its own. Each task is enqueued at most once
   * (guarded by existing runs), preventing runaway re-execution.
   */
  enqueueHeartbeatRuns(): string[] {
    const rows = this.db.prepare(`
      select t.id as task_id, t.org_id as org_id
      from tasks t
      join agents a on a.id = t.assignee_agent_id and a.org_id = t.org_id
      join providers p on p.id = a.model_provider_id and p.org_id = t.org_id
      where t.status in ('backlog', 'in_progress')
        and a.heartbeat_enabled = 1
        and a.lifecycle = 'active'
        and p.enabled = 1
        and not exists (select 1 from task_runs r where r.task_id = t.id and r.state in ('queued', 'running', 'completed'))
        and (select count(*) from task_runs r where r.task_id = t.id) < 3
    `).all() as Array<{ task_id: string; org_id: string }>;
    const created: string[] = [];
    for (const row of rows) {
      try {
        created.push(this.enqueueRun(row.org_id, row.task_id));
      } catch {
        // Skip tasks that cannot be prepared yet (e.g. provider not fully configured).
      }
    }
    return created;
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

  private loadChatContext(orgId: string, isolation: TaskRunIsolation): ChatContextBlock | null {
    let scope: { sourceMessageId?: string; sourceThreadId?: string };
    try {
      scope = JSON.parse(isolation.secretScopeJson);
    } catch {
      return null;
    }
    if (!scope.sourceThreadId) return null;
    const messages = this.db.prepare(`
      select m.body_md, m.sender_type, m.sender_id,
             coalesce(a.name, e.display_name, m.sender_type) as sender_name
      from chat_messages m
      left join agents a on a.id = m.sender_id and m.sender_type = 'agent'
      left join employees e on e.id = m.sender_id and m.sender_type = 'employee'
      where m.thread_id = ? and m.org_id = ?
      order by m.created_at asc
      limit 20
    `).all(scope.sourceThreadId, orgId) as Array<{ body_md: string; sender_type: string; sender_name: string }>;
    if (messages.length === 0) return null;
    return {
      threadId: scope.sourceThreadId,
      transcript: messages.map((m) => `[${m.sender_name}]: ${m.body_md}`).join("\n"),
    };
  }

  private loadInboxContext(orgId: string, agentId: string): InboxContextBlock | null {
    const messages = this.db.prepare(`
      select m.body_md,
             coalesce(a.name, e.display_name, m.sender_type) as sender_name,
             s.name as channel_name
      from chat_mentions cm
      join chat_messages m on m.id = cm.message_id
      join chat_spaces s on s.id = m.space_id
      left join agents a on a.id = m.sender_id and m.sender_type = 'agent'
      left join employees e on e.id = m.sender_id and m.sender_type = 'employee'
      where cm.target_type = 'agent' and cm.target_id = ? and m.org_id = ? and m.deleted_at is null
      order by m.created_at desc
      limit 10
    `).all(agentId, orgId) as Array<{ body_md: string; sender_name: string; channel_name: string }>;
    if (messages.length === 0) return null;
    return {
      transcript: messages.reverse().map((m) => `[${m.sender_name} in #${m.channel_name}]: ${m.body_md}`).join("\n"),
    };
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

  private completeRun(orgId: string, runId: string, providerRequestId: string): void {
    this.db.prepare(`
      update task_runs
      set state = ?, provider_request_id = ?, completed_at = ?, error_message = null
      where id = ? and org_id = ?
    `).run(TASK_RUN_STATE.COMPLETED, providerRequestId, new Date().toISOString(), runId, orgId);
  }

  private failRun(orgId: string, runId: string, providerRequestId: string | null, errorMessage: string): void {
    this.db.prepare(`
      update task_runs
      set state = ?, provider_request_id = coalesce(?, provider_request_id), completed_at = ?, error_message = ?
      where id = ? and org_id = ?
    `).run(TASK_RUN_STATE.FAILED, providerRequestId, new Date().toISOString(), errorMessage, runId, orgId);
  }

  private resolveSkillRuntimeSnapshot(orgId: string, agentId: string, runId: string): SkillRuntimeSnapshotRow | null {
    const hasEnabledSkill = this.db.prepare(`
      select id from skill_bindings
      where org_id = ? and agent_id = ? and enabled = 1
      limit 1
    `).get(orgId, agentId);
    if (!hasEnabledSkill) return null;
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
