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
import { canonicalMentionHandle } from "./mention-handles";

const TASK_RUN_STATE = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

interface TaskExecutionTaskRow {
  id: string;
  org_id: string;
  title: string;
  description: string;
  status: string;
  assignee_agent_id: string | null;
  risk: string;
  project_id: string | null;
  goal_id: string | null;
  workspace_id: string | null;
  priority: string;
  requires_filesystem: number;
}

interface TaskExecutionAgentRow {
  id: string;
  name: string;
  role: string;
  department: string;
  title: string;
  role_level: string;
  model_provider_id: string | null;
  model_id: string | null;
  manager_agent_id: string | null;
}

interface TaskExecutionProviderRow {
  id: string;
  label: string;
  provider_key: string;
  model: string | null;
}

interface ProjectRow {
  name: string;
  description: string;
}

interface GoalRow {
  title: string;
  description: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  local_path: string;
  repo_url: string;
  repo_ref: string;
}

interface TaskApprovalRow {
  id: string;
  state: string;
}

interface SkillRuntimeSnapshotRow {
  id: string;
  compiled_prompt: string;
  tools_manifest: string;
  source_revision_ids: string;
}

interface TaskRunIsolation {
  executionContextId: string;
  serviceIdentityId: string;
  workspaceMountJson: string;
  secretScopeJson: string;
}

interface ChatContextBlock {
  threadId: string;
  transcript: string;
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
      const result = await runAgentLoop(
        { providers: this.providers, tools: { db: this.db, organization: this.organization, chat: this.chat } },
        {
          orgId,
          providerId: provider.id,
          workspaceId: task.workspace_id,
          instructions: buildAgentInstructions(agent),
          initialUserTurn: buildTaskPrompt({
            task,
            agent,
            provider,
            project: this.project(task.project_id),
            goal: this.goal(task.goal_id),
            workspace,
            isolation,
            skillRuntimeSnapshot,
            isManager: !agent.manager_agent_id,
            hasReports: this.agentHasReports(orgId, agent.id),
            managerName: this.agentName(orgId, agent.manager_agent_id),
            chatContext,
          }),
          toolContext,
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

function buildAgentInstructions(agent: TaskExecutionAgentRow): string {
  return [
    `You are ${agent.name}, ${agent.title || agent.role} (${agent.department}, ${agent.role_level}) operating an autonomous AI company.`,
    "You act by calling tools: hire_agent staffs your team, create_task delegates work and assigns it by agent name, update_task_status tracks progress, write_deliverable produces real files in the company workspace, create_document produces versioned company documents (PRDs, specs, memos, reports), and send_message posts coordination messages to a channel with optional file attachments.",
    "Communicate like a real team. Post to the channel that matches the work — 'engineering' for engineering, 'product' for product or design, otherwise 'general'. Use @mentions when addressing a teammate. When you hand work or files to a teammate, use send_message with /handoff @Name and attachment_file_ids containing the file_id returned by write_deliverable. To keep a hand-off as one conversation, reply in the same thread by passing the thread_id a previous send_message returned.",
    "Take concrete action with the tools and reserve narrative for brief summaries after coordination is posted.",
  ].join("\n");
}

function buildTaskPrompt(input: {
  task: TaskExecutionTaskRow;
  agent: TaskExecutionAgentRow;
  provider: TaskExecutionProviderRow;
  project: ProjectRow | null;
  goal: GoalRow | null;
  workspace: WorkspaceRow | null;
  isolation: TaskRunIsolation;
  skillRuntimeSnapshot: SkillRuntimeSnapshotRow | null;
  isManager: boolean;
  hasReports: boolean;
  managerName: string | null;
  chatContext: ChatContextBlock | null;
}): string {
  const lines = [
    "Execute this AgentCompany task.",
    "",
    `Task: ${input.task.title}`,
    `Description: ${input.task.description}`,
    `Status: ${input.task.status}`,
    `Priority: ${input.task.priority}`,
    `Risk: ${input.task.risk}`,
    `Requires filesystem: ${input.task.requires_filesystem === 1 ? "yes" : "no"}`,
    `Assignee: ${input.agent.name} (${input.agent.role})`,
    ...(input.managerName ? [`Reports to: ${input.managerName}`] : []),
    `Provider: ${input.provider.label} ${input.provider.model ?? input.agent.model_id ?? ""}`.trim(),
    `Execution context: ${input.isolation.executionContextId}`,
    `Service identity: ${input.isolation.serviceIdentityId}`,
  ];
  if (input.goal) lines.push("", `Goal: ${input.goal.title}`, `Goal detail: ${input.goal.description}`);
  if (input.project) lines.push("", `Project: ${input.project.name}`, `Project detail: ${input.project.description}`);
  if (input.workspace) {
    lines.push(
      "",
      `Workspace: ${input.workspace.name}`,
      `Local path: ${input.workspace.local_path}`,
      `Repo: ${input.workspace.repo_url}`,
      `Ref: ${input.workspace.repo_ref}`,
      `Mounts: ${input.isolation.workspaceMountJson}`,
    );
  }
  lines.push("", `Secret scope: ${input.isolation.secretScopeJson}`);
  if (input.skillRuntimeSnapshot) {
    lines.push(
      "",
      "Skill runtime:",
      input.skillRuntimeSnapshot.compiled_prompt,
      "",
      `Tool allowlist: ${input.skillRuntimeSnapshot.tools_manifest}`,
      `Skill revisions: ${input.skillRuntimeSnapshot.source_revision_ids}`,
    );
  }
  if (input.chatContext) {
    lines.push(
      "",
      "Chat thread you are replying to:",
      input.chatContext.transcript,
      "",
      `Reply in this thread by passing thread_id="${input.chatContext.threadId}" to send_message.`,
    );
  }
  if (input.isManager && !input.hasReports) {
    lines.push(
      "",
      "Your team is currently empty. Hire 3-5 direct reports for the roles this goal needs (hire_agent), create and assign their first tasks (create_task), and write the initial operating plan into the workspace (write_deliverable). Then use send_message with /handoff @Name and attachment_file_ids to pass the operating plan to the relevant report. For EACH report, send_message to that report's department channel (engineering, product, or general) using an @mention and the work you assigned them — start a new thread per report and note the thread_id it returns. Post the company-wide kickoff to #general. Then summarize.",
    );
  } else {
    const manager = input.managerName ?? "your manager";
    const managerReference = input.managerName ? `${manager} (${agentMention(input.managerName)})` : manager;
    lines.push(
      "",
      `Complete this task: do the work, write your output as real files with write_deliverable, then send_message to your department channel (engineering, product, or general) reporting your progress and completion to ${managerReference}. Use /handoff with attachment_file_ids when passing files. Reply in the assignment thread if you were given a thread_id. Update the task status when done, and summarize.`,
    );
  }
  return lines.join("\n");
}

function agentMention(name: string): string {
  return `@${canonicalMentionHandle(name)}`;
}
