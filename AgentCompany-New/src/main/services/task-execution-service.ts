import type { DatabaseSync } from "node:sqlite";
import type { RunTaskInput } from "../../shared/commands";
import { APPROVAL_STATE, PROVIDER_EXECUTION_MODE, RISK_LEVEL } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { ProviderService } from "./provider-service";

const TASK_RUN_STATE = {
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
  name: string;
  local_path: string;
  repo_url: string;
  repo_ref: string;
}

interface TaskApprovalRow {
  id: string;
  state: string;
}

export class TaskExecutionService {
  private readonly audit: AuditService;

  constructor(
    private readonly db: DatabaseSync,
    private readonly providers: ProviderService = new ProviderService(db),
  ) {
    this.audit = new AuditService(db);
  }

  async runTask(input: RunTaskInput): Promise<string> {
    const task = this.requireTask(input.orgId, input.taskId);
    this.assertExecutionApproval(input.orgId, task);
    const agent = this.requireAssignedAgent(input.orgId, task);
    const provider = this.requireAgentProvider(input.orgId, agent);
    const runId = this.createRun(input.orgId, task.id, agent.id, provider.id);
    let providerRequestId: string | null = null;

    try {
      const requestId = await this.providers.createResponse({
        orgId: input.orgId,
        providerId: provider.id,
        prompt: buildTaskPrompt({
          task,
          agent,
          provider,
          project: this.project(task.project_id),
          goal: this.goal(task.goal_id),
          workspace: this.workspace(task.workspace_id),
        }),
        instructions: buildAgentInstructions(agent),
        executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND,
        onRequestCreated: (requestId) => {
          providerRequestId = requestId;
          this.linkProviderRequest(input.orgId, runId, requestId);
        },
      });
      this.completeRun(input.orgId, runId, requestId);
      this.audit.record({
        orgId: input.orgId,
        entityType: "task_run",
        entityId: runId,
        actorType: "system",
        actorId: null,
        action: "completed",
        payload: { taskId: task.id, agentId: agent.id, providerId: provider.id, providerRequestId: requestId },
      });
      return runId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failRun(input.orgId, runId, providerRequestId, message);
      this.audit.record({
        orgId: input.orgId,
        entityType: "task_run",
        entityId: runId,
        actorType: "system",
        actorId: null,
        action: "failed",
        payload: { taskId: task.id, agentId: agent.id, providerId: provider.id, providerRequestId, errorMessage: message },
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
      select id, name, role, department, title, role_level, model_provider_id, model_id
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

  private createRun(orgId: string, taskId: string, agentId: string, providerId: string): string {
    const runId = createId("run");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into task_runs(
        id, org_id, task_id, agent_id, provider_id, provider_request_id,
        trigger, state, created_at, started_at, completed_at, error_message
      ) values (?, ?, ?, ?, ?, null, ?, ?, ?, ?, null, null)
    `).run(runId, orgId, taskId, agentId, providerId, "manual", TASK_RUN_STATE.RUNNING, now, now);
    this.audit.record({
      orgId,
      entityType: "task_run",
      entityId: runId,
      actorType: "system",
      actorId: null,
      action: "started",
      payload: { taskId, agentId, providerId, trigger: "manual" },
    });
    return runId;
  }

  private linkProviderRequest(orgId: string, runId: string, providerRequestId: string): void {
    this.db.prepare("update task_runs set provider_request_id = ? where id = ? and org_id = ?")
      .run(providerRequestId, runId, orgId);
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
    return (this.db.prepare("select name, local_path, repo_url, repo_ref from workspaces where id = ?").get(workspaceId) as unknown as WorkspaceRow | undefined) ?? null;
  }
}

function buildAgentInstructions(agent: TaskExecutionAgentRow): string {
  return [
    `You are ${agent.name}, ${agent.title || agent.role}.`,
    `Department: ${agent.department}.`,
    `Role level: ${agent.role_level}.`,
    "Return an auditable execution result with concrete output and next action.",
  ].join("\n");
}

function buildTaskPrompt(input: {
  task: TaskExecutionTaskRow;
  agent: TaskExecutionAgentRow;
  provider: TaskExecutionProviderRow;
  project: ProjectRow | null;
  goal: GoalRow | null;
  workspace: WorkspaceRow | null;
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
    `Provider: ${input.provider.label} ${input.provider.model ?? input.agent.model_id ?? ""}`.trim(),
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
    );
  }
  lines.push("", "Deliverable: completed work, decisions made, evidence needed, and next action.");
  return lines.join("\n");
}
