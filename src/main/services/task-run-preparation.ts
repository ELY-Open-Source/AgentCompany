import type { DatabaseSync } from "node:sqlite";
import { APPROVAL_STATE, RISK_LEVEL } from "../../shared/domain";
import { createId } from "../../shared/ids";
import type {
  GoalRow,
  ProjectRow,
  TaskExecutionAgentRow,
  TaskExecutionProviderRow,
  TaskExecutionTaskRow,
  TaskRunIsolation,
  WorkspaceRow,
} from "./task-prompts";

interface TaskApprovalRow {
  id: string;
  state: string;
}

export function requireTask(db: DatabaseSync, orgId: string, taskId: string): TaskExecutionTaskRow {
  const task = db.prepare("select * from tasks where id = ? and org_id = ?").get(taskId, orgId) as TaskExecutionTaskRow | undefined;
  if (!task) throw new Error("Task was not found.");
  return task;
}

export function requireAssignedAgent(db: DatabaseSync, orgId: string, task: TaskExecutionTaskRow): TaskExecutionAgentRow {
  if (!task.assignee_agent_id) throw new Error("Task requires an assigned agent.");
  const agent = db.prepare(`
    select id, name, role, department, title, role_level, model_provider_id, model_id, manager_agent_id
    from agents
    where id = ? and org_id = ?
  `).get(task.assignee_agent_id, orgId) as TaskExecutionAgentRow | undefined;
  if (!agent) throw new Error("Task assignee was not found.");
  return agent;
}

export function assertExecutionApproval(db: DatabaseSync, orgId: string, task: TaskExecutionTaskRow): void {
  const problem = executionApprovalProblem(db, orgId, task);
  if (problem) throw new Error(problem);
}

/** Why the task may not execute without approval, or null when it may. */
export function executionApprovalProblem(db: DatabaseSync, orgId: string, task: TaskExecutionTaskRow): string | null {
  if (task.risk !== RISK_LEVEL.HIGH && task.requires_filesystem !== 1) return null;
  const approval = db.prepare(`
    select id, state
    from approvals
    where org_id = ?
      and source_entity_type = 'task'
      and source_entity_id = ?
      and kind in ('task_risk', 'task_execution')
    order by created_at desc
    limit 1
  `).get(orgId, task.id) as TaskApprovalRow | undefined;
  if (!approval || approval.state !== APPROVAL_STATE.APPROVED) return "Approved task execution approval is required.";
  return null;
}

/** The workspace a run of this task may touch, and how. */
export function workspaceAccess(task: TaskExecutionTaskRow, workspace: WorkspaceRow | null): Array<{ workspaceId: string; mode: string }> {
  return workspace ? [{ workspaceId: workspace.id, mode: task.requires_filesystem === 1 ? "read_write" : "read_only" }] : [];
}

/** True when a run's recorded mounts grant exactly the access the task needs now. */
export function sameWorkspaceAccess(mountJson: string, current: Array<{ workspaceId: string; mode: string }>): boolean {
  const recorded = (JSON.parse(mountJson) as Array<{ workspaceId: string; mode: string }>)
    .map((mount) => ({ workspaceId: mount.workspaceId, mode: mount.mode }));
  return JSON.stringify(recorded) === JSON.stringify(current);
}

export function requireAgentProvider(db: DatabaseSync, orgId: string, agent: TaskExecutionAgentRow): TaskExecutionProviderRow {
  if (!agent.model_provider_id) throw new Error("Task assignee requires a model provider.");
  const provider = db.prepare(`
    select id, label, provider_key, model, context_window_tokens
    from providers
    where id = ? and org_id = ?
  `).get(agent.model_provider_id, orgId) as TaskExecutionProviderRow | undefined;
  if (!provider) throw new Error("Task assignee provider was not found.");
  return provider;
}

export function loadProject(db: DatabaseSync, projectId: string | null): ProjectRow | null {
  if (!projectId) return null;
  return (db.prepare("select name, description from projects where id = ?").get(projectId) as unknown as ProjectRow | undefined) ?? null;
}

export function loadGoal(db: DatabaseSync, goalId: string | null): GoalRow | null {
  if (!goalId) return null;
  return (db.prepare("select title, description from goals where id = ?").get(goalId) as unknown as GoalRow | undefined) ?? null;
}

export function loadWorkspace(db: DatabaseSync, workspaceId: string | null): WorkspaceRow | null {
  if (!workspaceId) return null;
  return (db.prepare("select id, name, local_path, repo_url, repo_ref from workspaces where id = ?").get(workspaceId) as unknown as WorkspaceRow | undefined) ?? null;
}

export function createIsolationContext(
  db: DatabaseSync,
  orgId: string,
  task: TaskExecutionTaskRow,
  agent: TaskExecutionAgentRow,
  provider: TaskExecutionProviderRow,
  workspace: WorkspaceRow | null,
): TaskRunIsolation {
  if (task.requires_filesystem === 1 && !workspace) throw new Error("Filesystem tasks require a workspace.");
  const serviceIdentityId = requireServiceIdentity(db, orgId, agent.id);
  const executionContextId = createId("ctx");
  const workspaceMounts = workspace ? [{
    ...workspaceAccess(task, workspace)[0],
    name: workspace.name,
    localPath: workspace.local_path,
    repoRef: workspace.repo_ref,
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
      ...chatWakeSource(db, orgId, task),
    }),
  };
}

/** A re-run of a chat wake answers the same thread. */
function chatWakeSource(db: DatabaseSync, orgId: string, task: TaskExecutionTaskRow): { sourceThreadId: string; sourceMessageId: string } | Record<string, never> {
  if (task.origin !== "chat_wake") return {};
  const row = db.prepare(`
    select json_extract(secret_scope_json, '$.sourceThreadId') as thread_id,
           json_extract(secret_scope_json, '$.sourceMessageId') as message_id
    from task_runs
    where task_id = ? and org_id = ? and json_extract(secret_scope_json, '$.sourceThreadId') is not null
    order by created_at desc
    limit 1
  `).get(task.id, orgId) as { thread_id: string; message_id: string } | undefined;
  if (!row) throw new Error(`Chat wake task ${task.id} has no recorded source thread.`);
  return { sourceThreadId: row.thread_id, sourceMessageId: row.message_id };
}

function requireServiceIdentity(db: DatabaseSync, orgId: string, agentId: string): string {
  const row = db.prepare("select id from service_identities where org_id = ? and agent_id = ?")
    .get(orgId, agentId) as { id: string } | undefined;
  if (!row) throw new Error("Agent service identity was not found.");
  return row.id;
}
