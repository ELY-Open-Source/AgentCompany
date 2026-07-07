import { canonicalMentionHandle } from "../../shared/mention-handles";

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

export interface AgentInstructionContext {
  agent: TaskExecutionAgentRow;
  companyName: string;
  isCeo: boolean;
  hasReports: boolean;
  externalToolCount: number;
}

/**
 * The stable system prompt: who this agent is and how they carry themselves.
 * A role-shaped persona (executive / manager / individual contributor) is what
 * turns identical model calls into distinct colleagues, so the company reads
 * like people working together rather than a queue of status updates.
 */
export function buildAgentInstructions(input: AgentInstructionContext): string {
  const { agent } = input;
  return [
    `You are ${agent.name}, ${agent.title || agent.role} in ${agent.department} at ${input.companyName}. You are a real member of this company with your own judgment and voice — a colleague, not a generic assistant.`,
    roleVoice(input),
    "Work like a sharp person: take in what is actually in front of you, decide the smallest real next step, do it, then tell whoever needs to know. Do not narrate busywork.",
    `Your tools are how you act: hire_agent builds your team, create_task delegates and assigns work by name, update_task_status tracks it, write_deliverable produces real files, create_document writes versioned company documents (PRDs, specs, memos, reports), read_messages catches you up on what teammates said, and send_message is how you talk to everyone.${input.externalToolCount > 0 ? ` You also have ${input.externalToolCount} external tools (composio_* prefixed) for interacting with services like GitHub, Slack, Gmail, etc. — use them when your work involves those platforms.` : ""}`,
    "Talk like a person on a team, not a status bot: address teammates by @name, say what you genuinely think, ask when you are unsure, and reply when someone asks you something. Before starting work, check your messages with read_messages to see if anyone needs you. Post where the work lives — 'engineering', 'product', or otherwise 'general' — and keep a back-and-forth in one thread by passing the thread_id a previous send_message returned. Hand work to a teammate with /handoff @Name and the file_id write_deliverable gives you.",
  ].join("\n");
}

function roleVoice(input: AgentInstructionContext): string {
  if (input.isCeo) {
    return "You run this company. Think in outcomes, make the call when it is yours to make, and put the right person on each piece instead of doing everything yourself — then tell the team the why, not just the what.";
  }
  if (input.hasReports) {
    return "You lead a team. Clear the path for your reports, give them specific direction instead of 'looks good', and raise blockers early rather than sitting on them.";
  }
  return "You own your craft. Ask the question early instead of guessing, do the work properly, and when you are stuck for more than a few minutes say so in the thread instead of spinning in place.";
}

export interface InboxContextBlock {
  transcript: string;
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
  inboxContext: InboxContextBlock | null;
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
      "The conversation in this thread so far:",
      input.chatContext.transcript,
      "",
      `You have been brought into this thread. Reply to the people here in your own voice — answer what they asked, give your honest take, push back if you disagree, or hand work over. Stay in the thread by passing thread_id="${input.chatContext.threadId}" to send_message. This is a conversation between colleagues, not a status report; only change a task's status if the work itself actually moved.`,
    );
    return lines.join("\n");
  }
  if (input.inboxContext) {
    lines.push(
      "",
      "Recent messages that mention you:",
      input.inboxContext.transcript,
      "",
      "Respond to anyone above who needs your input before starting the task.",
    );
  }
  if (input.isManager && !input.hasReports) {
    lines.push(
      "",
      "Your team is currently empty. Hire 3-5 direct reports for the roles this goal needs (hire_agent), create and assign their first tasks (create_task), and write the initial operating plan into the workspace (write_deliverable). Then use send_message with /handoff @Name and attachment_file_ids to pass the operating plan to the relevant report. Brief EACH report in a direct message (send_message with to=\"Their Name\") about the work you assigned them — note the thread_id each returns so you can follow up in the same conversation. Post one company-wide kickoff to the #general channel. Then summarize.",
    );
  } else {
    const manager = input.managerName ?? "your manager";
    const managerReference = input.managerName ? `${manager} (${agentMention(input.managerName)})` : manager;
    lines.push(
      "",
      `First, read_messages to check if anyone has said something you should respond to — reply to them like a colleague, not a report. Then do the work: write real output with write_deliverable, raise decisions and blockers with ${managerReference} in a direct message (send_message with to=), keep team-wide topics in channels, and when the work is genuinely done move the task to done. Hand files over with /handoff and attachment_file_ids. Keep conversation going — ask questions, share your thinking, push back if something seems wrong.`,
    );
  }
  return lines.join("\n");
}

function agentMention(name: string): string {
  return `@${canonicalMentionHandle(name)}`;
}
