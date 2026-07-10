import type { DatabaseSync } from "node:sqlite";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS, type RiskLevel } from "../../shared/domain";
import { ORGANIZATION_DEPARTMENTS } from "./org-governance-service";
import type { OrganizationService } from "./organization-service";
import type { ChatService } from "./chat-service";
import { canonicalMentionHandle } from "../../shared/mention-handles";
import { readMessagesTool } from "./agent-read-messages";
import { grantConnectorTool, listConnectorsTool } from "./agent-connector-tools";
import { bindSkillSlugs, grantSkillTool, listSkillsTool } from "./agent-skill-tools";
import { createDocumentTool, writeDeliverableTool } from "./agent-deliverable-tools";
import { completeGoalTool, GOAL_TOOLS } from "./agent-goal-tools";
import { describeSend } from "./agent-message-presence";
import { optionalString, optionalStringArray, requireString } from "./agent-tool-args";
import type { JsonRecord } from "./provider-http";
import type { ToolCall, ToolDefinition } from "./provider-tool-turn";

const HIRE_BUDGET_CENTS = 25000;
const HEARTBEAT_INTERVAL_SEC = 120;

export interface AgentToolContext {
  orgId: string;
  /** The acting agent (the CEO during team-building). */
  agent: { id: string; modelProviderId: string | null; modelId: string | null };
  taskProjectId: string | null;
  taskGoalId: string | null;
  /** writeAccess mirrors the task's approved filesystem grant (read_write mount) and gates run_command. */
  workspace: { id: string; localPath: string; writeAccess: boolean } | null;
}

export interface AgentToolDeps {
  db: DatabaseSync;
  organization: OrganizationService;
  chat: ChatService;
}

export interface AgentToolDispatchOptions {
  announceTaskAssignments?: boolean;
}

/** The tools the acting agent may call during a run. */
export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: "hire_agent",
    description:
      "Add one direct report to your org. Hires report to YOU, so build a real company: the CEO hires chief officers (seniority \"director\", title like 'CTO' or 'CFO') and delegates department building to them; officers hire their own managers (seniority \"lead\") and staff. Staff every hire with the library skills their role needs (check list_skills; several are fine) — those skills become mandatory practice in the hire's runs.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Full name of the new agent." },
        role: { type: "string", description: "Their role, e.g. 'Growth Marketer'." },
        title: { type: "string", description: "Business-card title, e.g. 'CTO', 'Engineering Manager'. Defaults to the role." },
        department: { type: "string", enum: [...ORGANIZATION_DEPARTMENTS], description: "The company department the hire belongs to." },
        seniority: { type: "string", enum: ["director", "lead", "staff"], description: "Rank in the org: director for chief officers/department heads, lead for managers, staff for individual contributors. Defaults to staff." },
        model: { type: "string", description: "Optional model id; defaults to your own model." },
        skills: {
          type: "array",
          items: { type: "string" },
          description: "Skill slugs from list_skills this hire must work with, e.g. ['engineering-backend-architect']. Every agent also carries the humanizer house-style skill automatically.",
        },
      },
      required: ["name", "role", "department"],
    },
  },
  {
    name: "create_task",
    description: "Create a task for the team and optionally assign it to one of your reports by name.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        assignee_agent_name: { type: "string", description: "Name of the agent to assign, if any." },
        risk: { type: "string", enum: ["low", "medium", "high"] },
        requires_filesystem: {
          type: "boolean",
          description: "Set true for engineering work that must change code or run commands (build, test) in the workspace. The assignee then gets run_command; the operator approves such tasks before they execute.",
        },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "update_task_status",
    description: "Move a task to a new status.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        task_id: { type: "string" },
        status: { type: "string", enum: ["backlog", "in_progress", "review", "done"] },
      },
      required: ["task_id", "status"],
    },
  },
  {
    name: "write_deliverable",
    description: "Write a deliverable file into the company workspace folder (relative path). Use this to produce real output.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Relative path inside the workspace, e.g. 'plan/business-plan.md'." },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "send_message",
    description: "Talk to your teammates the way colleagues do. For anything meant for one person — task updates, questions, reports to your manager, hand-offs — send a direct message with `to` so each conversation stays separate. Use a `channel` only for genuinely team-wide topics: 'engineering' for engineering, 'product' for product/design, 'general' for company-wide. Pass exactly one of `to` or `channel`. @mention people you address in channels, attach deliverable file ids with attachment_file_ids, and use /handoff @Name when passing a file. Reply inside a thread by passing its thread_id to keep one conversation together.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        to: { type: "string", description: "Teammate name for a direct 1:1 message, e.g. 'CEO' or 'Ava Patel'. Preferred for anything addressed to one person." },
        channel: { type: "string", description: "Channel for team-wide topics: 'engineering', 'product', or 'general'." },
        body: { type: "string", description: "The message. Use @mentions for teammates and slash commands such as /handoff @Name when passing files." },
        thread_id: { type: "string", description: "Reply inside an existing thread — pass the thread_id a prior send_message returned. Omit to start a new thread." },
        attachment_file_ids: {
          type: "array",
          items: { type: "string" },
          description: "Approved file object ids to attach to this chat message.",
        },
      },
      required: ["body"],
    },
  },
  {
    name: "read_messages",
    description: "Read recent messages from a channel, a direct conversation, or your direct mentions. Check what your teammates have been saying before you respond or start work.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        channel: { type: "string", description: "Channel name: 'engineering', 'product', 'general'." },
        with: { type: "string", description: "Teammate name to read your direct conversation with, e.g. 'CEO'." },
        limit: { type: "number", description: "Number of recent messages (default 10, max 30)." },
      },
      required: [],
    },
  },
  {
    name: "create_document",
    description: "Create a company document (PRD, spec, memo, report, runbook, proposal, policy, guide). Use this for structured deliverables that the company should keep versioned.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        doc_type: { type: "string", enum: ["prd", "spec", "memo", "report", "runbook", "proposal", "policy", "guide"] },
        content: { type: "string", description: "Full document content in markdown." },
      },
      required: ["title", "doc_type", "content"],
    },
  },
  {
    name: "list_connectors",
    description: "See which external connectors (GitHub, Slack, Gmail, ...) the company has connected and who holds a grant for each. Check this before asking for access or planning work that needs an external service.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "grant_connector",
    description: "CEO only: grant a teammate access to one of the company's connected external toolkits. Match the tool to the job — engineers get code tools, marketers get social tools.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        agent_name: { type: "string", description: "The teammate receiving access." },
        toolkit: { type: "string", description: "Connected toolkit slug, e.g. 'github'." },
      },
      required: ["agent_name", "toolkit"],
    },
  },
  {
    name: "revoke_connector",
    description: "CEO only: withdraw a teammate's access to a connected external toolkit.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        agent_name: { type: "string", description: "The teammate losing access." },
        toolkit: { type: "string", description: "Connected toolkit slug, e.g. 'github'." },
      },
      required: ["agent_name", "toolkit"],
    },
  },
  {
    name: "list_skills",
    description: "See the company's skill library and who holds each skill. You carry every skill automatically as CEO; teammates only run with skills you grant them.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "grant_skill",
    description: "CEO only: grant a teammate one of the company's skills so its instructions join their next run. Match the skill to the job.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        agent_name: { type: "string", description: "The teammate receiving the skill." },
        skill: { type: "string", description: "Skill slug from list_skills, e.g. 'release-gate'." },
      },
      required: ["agent_name", "skill"],
    },
  },
  {
    name: "revoke_skill",
    description: "CEO only: withdraw a teammate's skill.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        agent_name: { type: "string", description: "The teammate losing the skill." },
        skill: { type: "string", description: "Skill slug, e.g. 'release-gate'." },
      },
      required: ["agent_name", "skill"],
    },
  },
  ...GOAL_TOOLS,
];

export function dispatchAgentTool(
  deps: AgentToolDeps,
  ctx: AgentToolContext,
  call: ToolCall,
  options: AgentToolDispatchOptions = {},
): string {
  try {
    switch (call.name) {
      case "hire_agent":
        return hireAgent(deps, ctx, call.arguments);
      case "create_task":
        return createTask(deps, ctx, call.arguments, options);
      case "update_task_status":
        return updateTaskStatus(deps, ctx, call.arguments);
      case "complete_goal":
        return completeGoalTool(deps, ctx);
      case "write_deliverable":
        return writeDeliverableTool(deps, ctx, call.arguments);
      case "send_message":
        return sendMessageTool(deps, ctx, call.arguments);
      case "read_messages":
        return readMessagesTool(deps, ctx, call.arguments);
      case "create_document":
        return createDocumentTool(deps, ctx, call.arguments);
      case "list_connectors":
        return listConnectorsTool(deps, ctx);
      case "grant_connector":
        return grantConnectorTool(deps, ctx, call.arguments, "grant");
      case "revoke_connector":
        return grantConnectorTool(deps, ctx, call.arguments, "revoke");
      case "list_skills":
        return listSkillsTool(deps, ctx);
      case "grant_skill":
        return grantSkillTool(deps, ctx, call.arguments, "grant");
      case "revoke_skill":
        return grantSkillTool(deps, ctx, call.arguments, "revoke");
      default:
        return `ERROR: unknown tool "${call.name}".`;
    }
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const HIRE_SENIORITIES = new Set(["director", "lead", "staff"]);

function hireAgent(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  if (!ctx.agent.modelProviderId) throw new Error("Acting agent has no model provider to assign hires.");
  const name = requireString(args.name, "name");
  const role = requireString(args.role, "role");
  const department = requireString(args.department, "department");
  const title = optionalString(args.title) ?? role;
  const seniority = (optionalString(args.seniority) ?? "staff").toLowerCase();
  if (!HIRE_SENIORITIES.has(seniority)) {
    throw new Error(`"seniority" must be one of director, lead, staff. (c_suite is reserved for the CEO.)`);
  }
  const model = optionalString(args.model) ?? ctx.agent.modelId;
  const requestedSkills = optionalStringArray(args.skills, "skills");
  const agentId = deps.organization.createAgent({
    orgId: ctx.orgId,
    name,
    role,
    title,
    department,
    modelProviderId: ctx.agent.modelProviderId,
    modelId: model,
    budgetCents: HIRE_BUDGET_CENTS,
    managerAgentId: ctx.agent.id,
    roleLevel: seniority,
    workspaceId: ctx.workspace?.id ?? null,
    heartbeatEnabled: true,
    heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
  });
  const { granted, unknown } = bindSkillSlugs(deps, ctx.orgId, agentId, requestedSkills);
  const skillNote = granted.length > 0 ? ` They carry: ${granted.join(", ")} (plus the automatic humanizer house style).` : "";
  const unknownNote = unknown.length > 0 ? ` Unknown skills skipped: ${unknown.join(", ")} — run list_skills and grant_skill to fix.` : "";
  return `Hired ${name} as ${title} (${seniority}) in ${department}, reporting to you (agent_id=${agentId}).${skillNote}${unknownNote}`;
}

function createTask(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord, options: AgentToolDispatchOptions): string {
  const title = requireString(args.title, "title");
  const description = requireString(args.description, "description");
  const assigneeName = optionalString(args.assignee_agent_name);
  const assignee = assigneeName ? requireRunnableAgentByName(deps.db, ctx.orgId, assigneeName) : null;
  const create = () => {
    const taskId = deps.organization.createTask({
      orgId: ctx.orgId,
      title,
      description,
      status: TASK_STATUS.BACKLOG,
      assigneeAgentId: assignee?.id ?? null,
      risk: normalizeRisk(args.risk),
      projectId: ctx.taskProjectId,
      goalId: ctx.taskGoalId,
      workspaceId: ctx.workspace?.id ?? null,
      priority: TASK_PRIORITY.NORMAL,
      requiresFilesystem: args.requires_filesystem === true,
    });
    const assignmentThread = options.announceTaskAssignments !== false && assignee && assignee.id !== ctx.agent.id
      ? postAssignmentMessage(deps, ctx, { taskId, title, description, assignee })
      : null;
    return { taskId, assignmentThread };
  };
  const { taskId, assignmentThread } = assignee ? withSavepoint(deps.db, "agent_create_task_assignment", create) : create();
  return `Created task "${title}" (task_id=${taskId})${assignee ? ` assigned to ${assignee.name}` : " (unassigned)"}${assignmentThread ? ` in thread_id="${assignmentThread}"` : ""}.`;
}

function updateTaskStatus(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const taskId = requireString(args.task_id, "task_id");
  const status = normalizeStatus(args.status);
  deps.organization.updateTaskStatus(ctx.orgId, taskId, status);
  return `Task ${taskId} moved to ${status}.`;
}


function sendMessageTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const channel = optionalString(args.channel);
  const to = optionalString(args.to);
  const body = requireString(args.body, "body");
  const threadId = optionalString(args.thread_id);
  const attachmentFileIds = optionalStringArray(args.attachment_file_ids, "attachment_file_ids");
  if (Boolean(channel) === Boolean(to)) throw new Error('Pass exactly one of "to" (direct message) or "channel".');

  const destination = to
    ? directSpaceWith(deps, ctx, to)
    : channelSpace(deps.db, ctx.orgId, channel!);

  const sent = withSavepoint(deps.db, "agent_send_message", () => {
    const messageId = deps.chat.sendMessage({
      orgId: ctx.orgId,
      spaceId: destination.spaceId,
      threadId,
      senderType: "agent",
      senderId: ctx.agent.id,
      bodyMd: body,
      attachmentFileIds,
    });
    const row = deps.db.prepare("select thread_id from chat_messages where id = ?").get(messageId) as { thread_id: string };
    return { messageId, threadId: row.thread_id };
  });
  if (destination.kind === "direct") {
    return [
      `Your direct message to ${destination.counterpartName} is delivered; they can see it and reply in your conversation.`,
      `To stay in this conversation, reply with to="${destination.counterpartName}" and thread_id="${sent.threadId}".`,
    ].join(" ");
  }
  return describeSend(deps.db, ctx.agent.id, destination.label, destination.spaceId, sent.messageId, sent.threadId);
}

interface ChannelDestination {
  kind: "channel";
  spaceId: string;
  label: string;
}

interface DirectDestination {
  kind: "direct";
  spaceId: string;
  counterpartName: string;
}

function channelSpace(db: DatabaseSync, orgId: string, channel: string): ChannelDestination {
  const space = db.prepare(
    "select id from chat_spaces where org_id = ? and lower(name) = lower(?) and space_type <> 'direct' limit 1",
  ).get(orgId, channel) as { id: string } | undefined;
  if (!space) throw new Error(`No channel named "${channel}".`);
  return { kind: "channel", spaceId: space.id, label: channel };
}

function directSpaceWith(deps: AgentToolDeps, ctx: AgentToolContext, teammateName: string): DirectDestination {
  const counterpart = resolveTeammateByName(deps.db, ctx.orgId, teammateName);
  if (counterpart.type === "agent" && counterpart.id === ctx.agent.id) {
    throw new Error("You cannot open a direct conversation with yourself.");
  }
  const spaceId = deps.chat.ensureDirectSpace(
    ctx.orgId,
    { type: "agent", id: ctx.agent.id },
    { type: counterpart.type, id: counterpart.id },
  );
  return { kind: "direct", spaceId, counterpartName: counterpart.name };
}

function resolveTeammateByName(
  db: DatabaseSync,
  orgId: string,
  name: string,
): { type: "agent" | "employee"; id: string; name: string } {
  const trimmed = name.trim();
  const agent = db.prepare(
    "select id, name from agents where org_id = ? and lower(name) = lower(?) and lifecycle = 'active' limit 1",
  ).get(orgId, trimmed) as { id: string; name: string } | undefined;
  if (agent) return { type: "agent", id: agent.id, name: agent.name };
  const employee = db.prepare(
    "select id, display_name from employees where org_id = ? and lower(display_name) = lower(?) limit 1",
  ).get(orgId, trimmed) as { id: string; display_name: string } | undefined;
  if (employee) return { type: "employee", id: employee.id, name: employee.display_name };
  throw new Error(`No teammate named "${name}".`);
}


interface RunnableAssignmentAgent {
  id: string;
  name: string;
  department: string;
}

function requireRunnableAgentByName(db: DatabaseSync, orgId: string, name: string): RunnableAssignmentAgent {
  const row = db.prepare(`
    select a.id, a.name, a.department
    from agents a
    join providers p on p.id = a.model_provider_id and p.org_id = a.org_id
    join service_identities si on si.agent_id = a.id and si.org_id = a.org_id
    where a.org_id = ?
      and lower(a.name) = lower(?)
      and a.lifecycle = 'active'
      and p.enabled = 1
    limit 1
  `).get(orgId, name.trim()) as RunnableAssignmentAgent | undefined;
  if (!row) throw new Error(`No runnable agent named "${name}" with an enabled provider and service identity.`);
  return row;
}

function postAssignmentMessage(
  deps: AgentToolDeps,
  ctx: AgentToolContext,
  input: { taskId: string; title: string; description: string; assignee: RunnableAssignmentAgent },
): string {
  const spaceId = deps.chat.ensureDirectSpace(
    ctx.orgId,
    { type: "agent", id: ctx.agent.id },
    { type: "agent", id: input.assignee.id },
  );
  const body = [
    `@${canonicalMentionHandle(input.assignee.name)} take task_id=${input.taskId}: ${input.title}.`,
    input.description,
  ].join(" ");
  const messageId = deps.chat.sendMessage({
    orgId: ctx.orgId,
    spaceId,
    threadId: null,
    senderType: "agent",
    senderId: ctx.agent.id,
    bodyMd: body,
    attachmentFileIds: [],
  });
  const row = deps.db.prepare("select thread_id from chat_messages where id = ?").get(messageId) as { thread_id: string };
  return row.thread_id;
}

function withSavepoint<T>(db: DatabaseSync, name: string, operation: () => T): T {
  db.exec(`savepoint ${name}`);
  try {
    const result = operation();
    db.exec(`release savepoint ${name}`);
    return result;
  } catch (error) {
    db.exec(`rollback to savepoint ${name}`);
    db.exec(`release savepoint ${name}`);
    throw error;
  }
}

function normalizeRisk(value: unknown): RiskLevel {
  if (value === RISK_LEVEL.MEDIUM) return RISK_LEVEL.MEDIUM;
  if (value === RISK_LEVEL.HIGH) return RISK_LEVEL.HIGH;
  return RISK_LEVEL.LOW;
}

function normalizeStatus(value: unknown): string {
  const allowed = [TASK_STATUS.BACKLOG, TASK_STATUS.IN_PROGRESS, TASK_STATUS.REVIEW, TASK_STATUS.DONE] as string[];
  if (typeof value === "string" && allowed.includes(value)) return value;
  throw new Error(`Invalid status. Use one of: ${allowed.join(", ")}.`);
}
