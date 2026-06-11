import { canonicalMentionHandle } from "./mention-handles";

export interface TaskExecutionTaskRow {
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

export interface TaskExecutionAgentRow {
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

export interface TaskExecutionProviderRow {
  id: string;
  label: string;
  provider_key: string;
  model: string | null;
}

export interface ProjectRow {
  name: string;
  description: string;
}

export interface GoalRow {
  title: string;
  description: string;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  local_path: string;
  repo_url: string;
  repo_ref: string;
}

export interface TaskRunIsolation {
  executionContextId: string;
  serviceIdentityId: string;
  workspaceMountJson: string;
  secretScopeJson: string;
}

export interface SkillRuntimeSnapshotRow {
  id: string;
  compiled_prompt: string;
  tools_manifest: string;
  source_revision_ids: string;
}

export interface ChatContextBlock {
  threadId: string;
  transcript: string;
}

export function buildAgentInstructions(agent: TaskExecutionAgentRow): string {
  return [
    `You are ${agent.name}, ${agent.title || agent.role} (${agent.department}, ${agent.role_level}) operating an autonomous AI company.`,
    "You act by calling tools: hire_agent staffs your team, create_task delegates work and assigns it by agent name, update_task_status tracks progress, write_deliverable produces real files in the company workspace, create_document produces versioned company documents (PRDs, specs, memos, reports), and send_message posts coordination messages to a channel with optional file attachments.",
    "Communicate like a real team. Post to the channel that matches the work — 'engineering' for engineering, 'product' for product or design, otherwise 'general'. Use @mentions when addressing a teammate. When you hand work or files to a teammate, use send_message with /handoff @Name and attachment_file_ids containing the file_id returned by write_deliverable. To keep a hand-off as one conversation, reply in the same thread by passing the thread_id a previous send_message returned.",
    "Take concrete action with the tools and reserve narrative for brief summaries after coordination is posted.",
    "Every turn you must call a tool — never reply with prose alone. When, and only when, you have completed everything the task needs, call finish to end your turn.",
  ].join("\n");
}

export function buildTaskPrompt(input: {
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
      "Your team is currently empty. Hire 3-5 direct reports for the roles this goal needs (hire_agent), create and assign their first tasks (create_task), and write the initial operating plan into the workspace (write_deliverable). Then use send_message with /handoff @Name and attachment_file_ids to pass the operating plan to the relevant report. For EACH report, send_message to that report's department channel (engineering, product, or general) using an @mention and the work you assigned them — start a new thread per report and note the thread_id it returns. Post the company-wide kickoff to #general. Then call finish.",
    );
  } else {
    const manager = input.managerName ?? "your manager";
    const managerReference = input.managerName ? `${manager} (${agentMention(input.managerName)})` : manager;
    lines.push(
      "",
      `Complete this task: do the work, write your output as real files with write_deliverable, then send_message to your department channel (engineering, product, or general) reporting your progress and completion to ${managerReference}. Use /handoff with attachment_file_ids when passing files. Reply in the assignment thread if you were given a thread_id. Update the task status when done, then call finish.`,
    );
  }
  return lines.join("\n");
}

function agentMention(name: string): string {
  return `@${canonicalMentionHandle(name)}`;
}
