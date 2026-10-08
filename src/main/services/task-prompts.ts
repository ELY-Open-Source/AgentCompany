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
  handoff_json: string | null;
  origin: string | null;
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
  /** The space the thread lives in — where the run's reply must land. */
  spaceId: string;
  /** Messages up to and including the agent's last reply. */
  history: string;
  /** Messages after it: what this run answers. */
  fresh: string;
}

export interface AgentInstructionContext {
  agent: TaskExecutionAgentRow;
  companyName: string;
  isCeo: boolean;
  hasReports: boolean;
  /** Display names of the connected toolkits this agent carries in this run. */
  connectorNames: string[];
  /** The operator's app language; agents speak it back. */
  language: "en" | "zh";
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
    `Your tools are how you act: hire_agent builds your team, create_task delegates and assigns work by name (set requires_filesystem for engineering work that must change code or run commands), update_task_status tracks it, list_files and read_file explore the company workspace, write_deliverable produces real files, run_command builds and tests for real on filesystem tasks, create_document writes versioned company documents (PRDs, specs, memos, reports), read_messages catches you up on what teammates said, and send_message is how you talk to everyone. web_search and fetch_url reach the live web — look up APIs, docs, and facts instead of guessing them.`,
    ...(input.language === "zh"
      ? ["公司的工作语言是简体中文：你写的每一条消息、任务标题与描述、文档和交付物都用中文表达（代码、命令、API 名称等技术标识保持原样）。工具名称和工具参数的字段名仍按定义使用英文。"]
      : []),
    capabilityBriefing(input),
    "Talk like a person on a team, not a status bot: address teammates by @name, say what you genuinely think, ask when you are unsure, and reply when someone asks you something. Before starting work, check your messages with read_messages to see if anyone needs you. Post where the work lives — 'engineering', 'product', or otherwise 'general' — and keep a back-and-forth in one thread by passing the thread_id a previous send_message returned. Hand work to a teammate with /handoff @Name and the file_id write_deliverable gives you.",
  ].join("\n");
}

/**
 * What this agent can reach beyond the built-in tools, and how access moves:
 * the CEO carries everything and hands out grants; everyone else works with
 * what they were granted and knows where to ask for more.
 */
function capabilityBriefing(input: AgentInstructionContext): string {
  const lines: string[] = [];
  if (input.connectorNames.length > 0) {
    lines.push(
      `Connected external services you carry in this run: ${input.connectorNames.join(", ")}. Their tools arrive with the composio_ prefix — use them directly whenever the work touches those platforms instead of describing what you would do.`,
    );
  }
  lines.push(
    "list_connectors shows every service the company has connected and who holds it; list_skills shows the company's skill library. Check them before planning work that depends on an external platform or a playbook.",
  );
  if (input.isCeo) {
    lines.push(
      "You are the CEO: you automatically carry every connected service, and access for everyone else is yours to manage — when you delegate work that needs an external service, grant it first with grant_connector and take it back with revoke_connector when done. The company also ships a built-in skill library: staff every hire with the skills their role needs by passing skills to hire_agent (several per person is normal), and adjust later with grant_skill / revoke_skill. A teammate without the grant cannot use the tool or skill, so grant before you assign. The humanizer skill is company house style — every agent, you included, carries it automatically and must write like a person, not like an AI.",
    );
  } else if (input.connectorNames.length === 0) {
    lines.push(
      "You currently hold no connector grants. If this work needs an external service, message the CEO to grant it to you (they run grant_connector) rather than working around it.",
    );
  } else {
    lines.push(
      "If the work needs a service you do not carry yet, message the CEO to grant it to you (they run grant_connector).",
    );
  }
  return lines.join(" ");
}

function roleVoice(input: AgentInstructionContext): string {
  if (input.isCeo) {
    return [
      "You run this company. Think in outcomes, make the call when it is yours to make, and put the right person on each piece instead of doing everything yourself — then tell the team the why, not just the what.",
      "Build a real organization, the way OKR-run companies do: the company goal is your objective; hire chief officers for the functions it needs (hire_agent with seniority \"director\" and a title like CTO, CFO, CMO, COO — 2-4 of them, not a flat pool of ICs), hand each officer their department's objective as a task, and let them hire their own managers (seniority \"lead\") and staff. You manage the officers; they manage their departments.",
      "The goal closes on evidence, not paperwork: if it promises a product, the finish line is working code in the workspace that builds and passes its tests. Plans and specs are how work starts — make sure implementation lands as requires_filesystem tasks so the builders can actually build.",
    ].join(" ");
  }
  if (input.hasReports) {
    return "You lead a department. Break your objective into key results your team can own: hire the managers (seniority \"lead\") and staff your department needs with hire_agent, assign each report concrete tasks with create_task, and hold the line on quality. Delegate implementation with requires_filesystem: true so your engineers can change code and run tests — an objective that promises software is not done until it builds and passes in the workspace. Clear the path for your reports, give them specific direction instead of 'looks good', raise blockers to your manager early, and report progress up the chain.";
  }
  return "You own your craft. Ask the question early instead of guessing, do the work properly, and when you are stuck for more than a few minutes say so in the thread instead of spinning in place.";
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
  handoffLines: string[];
  /** Completed runs this task already spent without reaching done. */
  priorCompletedRuns: number;
}): string {
  const lines = [
    "Execute this AgentCompany task.",
    "",
    `Task: ${input.task.title}`,
    `Task id: ${input.task.id}`,
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
  lines.push(...input.handoffLines);
  lines.push("", `Secret scope: ${input.isolation.secretScopeJson}`);
  if (input.skillRuntimeSnapshot) {
    lines.push(
      "",
      "Skills you carry this run — these are mandatory working practice, not suggestions. Apply each one to how you work and what you produce:",
      input.skillRuntimeSnapshot.compiled_prompt,
      "",
      `Tool allowlist: ${input.skillRuntimeSnapshot.tools_manifest}`,
      `Skill revisions: ${input.skillRuntimeSnapshot.source_revision_ids}`,
    );
  }
  if (input.chatContext) {
    lines.push(
      "",
      "Earlier in this thread (context only — newer messages override it):",
      input.chatContext.history || "(nothing before)",
      "",
      "New since your last reply in this thread — this is what you are answering:",
      input.chatContext.fresh || "(nothing new since your last reply)",
      "",
      `You have been brought into this thread. Reply to the people here in your own voice — answer what they asked, give your honest take, push back if you disagree, or hand work over. Stay in the thread by passing thread_id="${input.chatContext.threadId}" to send_message. This is a conversation between colleagues, not a status report; only change a task's status if the work itself actually moved.`,
    );
    return lines.join("\n");
  }
  if (input.task.requires_filesystem === 1 && input.workspace) {
    lines.push(
      "",
      "This task carries filesystem access: read the existing code with list_files and read_file before changing anything, write changes with write_deliverable, and prove they work with run_command (install, build, test). Real output is code that builds and tests that pass — a document describing the work does not close an engineering task.",
    );
  }
  if (input.priorCompletedRuns > 0) {
    lines.push(
      "",
      `This task already spent ${input.priorCompletedRuns} completed run(s) without being closed. Check read_messages and the existing deliverables first, continue from where the last run stopped instead of redoing finished work, and if the work is actually complete just close the task.`,
    );
  }
  if (input.isManager && !input.hasReports) {
    lines.push(
      "",
      `Your team is currently empty. Hire 3-5 direct reports for the roles this goal needs (hire_agent), create and assign their first tasks (create_task), and write the initial operating plan into the workspace (write_deliverable). Then use send_message with /handoff @Name and attachment_file_ids to pass the operating plan to the relevant report. Brief EACH report in a direct message (send_message with to="Their Name") about the work you assigned them — note the thread_id each returns so you can follow up in the same conversation. Post one company-wide kickoff to the #general channel. Then close this kickoff with update_task_status(task_id="${input.task.id}", status="done") and summarize.`,
    );
  } else {
    const manager = input.managerName ?? "your manager";
    const managerReference = input.managerName ? `${manager} (${agentMention(input.managerName)})` : manager;
    lines.push(
      "",
      `First, read_messages to check if anyone has said something you should respond to — reply to them like a colleague, not a report. Then do the work: write real output with write_deliverable, raise decisions and blockers with ${managerReference} in a direct message (send_message with to=), and keep team-wide topics in channels. Hand files over with /handoff and attachment_file_ids. Keep conversation going — ask questions, share your thinking, push back if something seems wrong. Before you finish: if the work is genuinely done, call update_task_status(task_id="${input.task.id}", status="done"); if it needs another session, move it to "in_progress" and say in the thread what remains — an open task will be run again.`,
    );
  }
  return lines.join("\n");
}

function agentMention(name: string): string {
  return `@${canonicalMentionHandle(name)}`;
}
