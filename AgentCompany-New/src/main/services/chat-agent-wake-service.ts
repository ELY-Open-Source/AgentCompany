import type { DatabaseSync } from "node:sqlite";
import type { SendMessageInput } from "../../shared/commands";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../shared/domain";
import { createId } from "../../shared/ids";
import type { ResolvedMention } from "./chat-mentions";
import type { SlashInvocation } from "./chat-service-internal";
import { OrganizationService } from "./organization-service";

interface RunnableAgentRow {
  id: string;
  name: string;
  model_provider_id: string | null;
  workspace_id: string | null;
}

interface WorkspaceContext {
  id: string;
  name: string;
  local_path: string;
  repo_ref: string;
  project_id: string | null;
  goal_id: string | null;
}

export interface AgentWakeResult {
  targetId: string;
  taskId: string;
  runId: string;
}

export class ChatAgentWakeService {
  private readonly organization: OrganizationService;

  constructor(private readonly db: DatabaseSync) {
    this.organization = new OrganizationService(db);
  }

  wakeFromMention(input: SendMessageInput, agentId: string, messageId: string, threadId: string, now: string): AgentWakeResult {
    const agent = this.requireRunnableAgent(input.orgId, agentId);
    const workspace = this.workspaceForAgent(input.orgId, agent.workspace_id);
    const taskId = this.organization.createTask({
      orgId: input.orgId,
      title: `Chat reply: ${agent.name}`,
      description: this.mentionTaskDescription(input, messageId, threadId),
      status: TASK_STATUS.BACKLOG,
      assigneeAgentId: agent.id,
      risk: RISK_LEVEL.LOW,
      projectId: workspace?.project_id ?? null,
      goalId: workspace?.goal_id ?? null,
      workspaceId: workspace?.id ?? null,
      priority: TASK_PRIORITY.HIGH,
      requiresFilesystem: false,
    });
    const runId = this.createQueuedRun({ orgId: input.orgId, taskId, agent, workspace, messageId, threadId, now });
    this.recordPresence(agent.id, { command: "mention", args: "" }, now);
    return { targetId: agent.id, taskId, runId };
  }

  wakeFromSlash(input: SendMessageInput, mentions: ResolvedMention[], slash: SlashInvocation, messageId: string, threadId: string, now: string): AgentWakeResult {
    const targetId = this.requireAgentMention(mentions);
    const agent = this.requireRunnableAgent(input.orgId, targetId);
    const workspace = this.workspaceForAgent(input.orgId, agent.workspace_id);
    const taskId = this.organization.createTask({
      orgId: input.orgId,
      title: this.taskTitle(agent.name, slash),
      description: this.taskDescription(input, slash, messageId, threadId),
      status: TASK_STATUS.BACKLOG,
      assigneeAgentId: agent.id,
      risk: RISK_LEVEL.LOW,
      projectId: workspace?.project_id ?? null,
      goalId: workspace?.goal_id ?? null,
      workspaceId: workspace?.id ?? null,
      priority: TASK_PRIORITY.HIGH,
      requiresFilesystem: false,
    });
    const runId = this.createQueuedRun({ orgId: input.orgId, taskId, agent, workspace, messageId, threadId, now });
    this.recordPresence(agent.id, slash, now);
    return { targetId: agent.id, taskId, runId };
  }

  private requireAgentMention(mentions: ResolvedMention[]): string {
    const target = mentions.find((mention) => mention.target.type === "agent")?.target;
    if (!target || target.type !== "agent") throw new Error("Slash command /agent requires an agent mention.");
    return target.id;
  }

  private requireRunnableAgent(orgId: string, agentId: string): RunnableAgentRow {
    const agent = this.db.prepare(`
      select a.id, a.name, a.model_provider_id, a.workspace_id
      from agents a
      join providers p on p.id = a.model_provider_id and p.org_id = a.org_id
      where a.id = ?
        and a.org_id = ?
        and a.lifecycle = 'active'
        and p.enabled = 1
      limit 1
    `).get(agentId, orgId) as RunnableAgentRow | undefined;
    if (!agent) throw new Error("Slash command /agent requires an active agent with an enabled provider.");
    return agent;
  }

  private workspaceForAgent(orgId: string, workspaceId: string | null): WorkspaceContext | null {
    if (!workspaceId) return null;
    const workspace = this.workspaceById(orgId, workspaceId);
    if (!workspace) throw new Error("Agent workspace was not found.");
    return workspace;
  }

  private workspaceById(orgId: string, workspaceId: string): WorkspaceContext | null {
    return (this.db.prepare(`
      select w.id, w.name, w.local_path, w.repo_ref, w.project_id, p.goal_id
      from workspaces w
      left join projects p on p.id = w.project_id and p.org_id = w.org_id
      where w.org_id = ? and w.id = ?
      limit 1
    `).get(orgId, workspaceId) as WorkspaceContext | undefined) ?? null;
  }

  private createQueuedRun(input: {
    orgId: string;
    taskId: string;
    agent: RunnableAgentRow;
    workspace: WorkspaceContext | null;
    messageId: string;
    threadId: string;
    now: string;
  }): string {
    const providerId = input.agent.model_provider_id;
    if (!providerId) throw new Error("Slash command /agent requires an enabled provider.");
    const serviceIdentityId = this.requireServiceIdentity(input.orgId, input.agent.id);
    const runId = createId("run");
    const executionContextId = createId("ctx");
    const workspaceMountJson = JSON.stringify(input.workspace ? [{
      workspaceId: input.workspace.id,
      name: input.workspace.name,
      localPath: input.workspace.local_path,
      repoRef: input.workspace.repo_ref,
      mode: "read_only",
    }] : []);
    const secretScopeJson = JSON.stringify({
      serviceIdentityId,
      providerIds: [providerId],
      scope: "chat_mention",
      credentialAccess: "provider_runtime_only",
      sourceMessageId: input.messageId,
      sourceThreadId: input.threadId,
    });
    this.db.prepare(`
      insert into task_runs(
        id, org_id, task_id, agent_id, provider_id, provider_request_id,
        execution_context_id, service_identity_id, workspace_mount_json, secret_scope_json,
        trigger, state, created_at, started_at, completed_at, error_message
      )
      values (?, ?, ?, ?, ?, null, ?, ?, ?, ?, ?, ?, ?, null, null, null)
    `).run(
      runId,
      input.orgId,
      input.taskId,
      input.agent.id,
      providerId,
      executionContextId,
      serviceIdentityId,
      workspaceMountJson,
      secretScopeJson,
      "chat_mention",
      "queued",
      input.now,
    );
    return runId;
  }

  private requireServiceIdentity(orgId: string, agentId: string): string {
    const row = this.db.prepare("select id from service_identities where org_id = ? and agent_id = ?")
      .get(orgId, agentId) as { id: string } | undefined;
    if (!row) throw new Error("Agent service identity was not found.");
    return row.id;
  }

  private recordPresence(agentId: string, slash: SlashInvocation, now: string): void {
    this.db.prepare(`
      insert into chat_presence(principal_type, principal_id, status, status_text, last_seen_at)
      values (?, ?, ?, ?, ?)
      on conflict(principal_type, principal_id)
      do update set status = excluded.status, status_text = excluded.status_text, last_seen_at = excluded.last_seen_at
    `).run("agent", agentId, "thinking", slash.args.trim().slice(0, 160), now);
  }

  private taskTitle(agentName: string, slash: SlashInvocation): string {
    const details = slash.args.replace(/^@[^\s]+\s*/, "").trim();
    const title = details || `reply as ${agentName}`;
    return `Chat mention: ${title.length > 64 ? `${title.slice(0, 61)}...` : title}`;
  }

  private mentionTaskDescription(input: SendMessageInput, messageId: string, threadId: string): string {
    return [
      `Source message: ${messageId}`,
      `Source thread: ${threadId}`,
      `Source space: ${input.spaceId}`,
      `Sender: ${input.senderType}${input.senderId ? `:${input.senderId}` : ""}`,
      "",
      "You were @mentioned in a chat message. Read the thread context, then reply in the source thread with send_message and pass the thread_id above.",
    ].join("\n");
  }

  private taskDescription(input: SendMessageInput, slash: SlashInvocation, messageId: string, threadId: string): string {
    return [
      `Chat command: /agent ${slash.args.trim()}`,
      `Source message: ${messageId}`,
      `Source thread: ${threadId}`,
      `Source space: ${input.spaceId}`,
      `Sender: ${input.senderType}${input.senderId ? `:${input.senderId}` : ""}`,
      "",
      "Reply in the source thread with send_message and pass the thread_id above.",
    ].join("\n");
  }
}
