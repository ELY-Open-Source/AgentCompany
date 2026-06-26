import type { DatabaseSync } from "node:sqlite";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS, type RiskLevel } from "../../shared/domain";
import { ORGANIZATION_DEPARTMENTS } from "./org-governance-service";
import type { OrganizationService } from "./organization-service";
import type { ChatService } from "./chat-service";
import { writeDeliverable } from "./deliverable-writer";
import { DocumentService } from "./document-service";
import { recordWorkspaceFile } from "./files/file-object-store";
import { canonicalMentionHandle } from "./mention-handles";
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
  workspace: { id: string; localPath: string } | null;
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
      "Add one direct report to your team. During team building, call this 3-5 times to staff the roles you need before delegating work.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Full name of the new agent." },
        role: { type: "string", description: "Their role/title, e.g. 'Growth Marketer'." },
        department: { type: "string", enum: [...ORGANIZATION_DEPARTMENTS], description: "The company department the hire belongs to." },
        model: { type: "string", description: "Optional model id; defaults to your own model." },
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
    description: "Talk to your teammates in a channel — ask, answer, decide together, or hand off work, the way colleagues do. @mention the people you are addressing, attach deliverable file ids with attachment_file_ids, and use /handoff @Name when passing a file. Use the channel that matches the work: 'engineering' for engineering, 'product' for product/design, otherwise 'general'. Reply inside a thread by passing its thread_id to keep one conversation together.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        channel: { type: "string", description: "Channel: 'engineering', 'product', or 'general'." },
        body: { type: "string", description: "The message. Use @mentions for teammates and slash commands such as /handoff @Name when passing files." },
        thread_id: { type: "string", description: "Reply inside an existing thread — pass the thread_id a prior send_message returned. Omit to start a new thread." },
        attachment_file_ids: {
          type: "array",
          items: { type: "string" },
          description: "Approved file object ids to attach to this chat message.",
        },
      },
      required: ["channel", "body"],
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
      case "write_deliverable":
        return writeDeliverableTool(deps, ctx, call.arguments);
      case "send_message":
        return sendMessageTool(deps, ctx, call.arguments);
      case "create_document":
        return createDocumentTool(deps, ctx, call.arguments);
      default:
        return `ERROR: unknown tool "${call.name}".`;
    }
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function hireAgent(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  if (!ctx.agent.modelProviderId) throw new Error("Acting agent has no model provider to assign hires.");
  const name = requireString(args.name, "name");
  const role = requireString(args.role, "role");
  const department = requireString(args.department, "department");
  const model = optionalString(args.model) ?? ctx.agent.modelId;
  const agentId = deps.organization.createAgent({
    orgId: ctx.orgId,
    name,
    role,
    department,
    modelProviderId: ctx.agent.modelProviderId,
    modelId: model,
    budgetCents: HIRE_BUDGET_CENTS,
    managerAgentId: ctx.agent.id,
    roleLevel: "staff",
    workspaceId: ctx.workspace?.id ?? null,
    heartbeatEnabled: true,
    heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
  });
  return `Hired ${name} as ${role} in ${department} (agent_id=${agentId}).`;
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
      requiresFilesystem: false,
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

function writeDeliverableTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  if (!ctx.workspace) throw new Error("No workspace is bound to this task; cannot write deliverables.");
  const path = requireString(args.path, "path");
  const content = requireString(args.content, "content");
  const written = writeDeliverable({ workspaceRoot: ctx.workspace.localPath, relativePath: path, content });
  const fileId = recordWorkspaceFile(deps.db, {
    orgId: ctx.orgId,
    ownerType: "agent",
    ownerId: ctx.agent.id,
    workspaceRoot: ctx.workspace.localPath,
    relativePath: written,
  });
  return `Wrote deliverable ${written} (file_id=${fileId}, chars=${content.length}).`;
}

function sendMessageTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const channel = requireString(args.channel, "channel");
  const body = requireString(args.body, "body");
  const threadId = optionalString(args.thread_id);
  const attachmentFileIds = optionalStringArray(args.attachment_file_ids, "attachment_file_ids");
  const space = deps.db.prepare(
    "select id from chat_spaces where org_id = ? and lower(name) = lower(?) and space_type <> 'direct' limit 1",
  ).get(ctx.orgId, channel) as { id: string } | undefined;
  if (!space) throw new Error(`No channel named "${channel}".`);
  const messageId = deps.chat.sendMessage({
    orgId: ctx.orgId,
    spaceId: space.id,
    threadId,
    senderType: "agent",
    senderId: ctx.agent.id,
    bodyMd: body,
    attachmentFileIds,
  });
  const row = deps.db.prepare("select thread_id from chat_messages where id = ?").get(messageId) as { thread_id: string };
  return describeSend(deps.db, ctx.agent.id, channel, space.id, messageId, row.thread_id);
}

/**
 * What the sending agent hears back: who is in the channel and who they just
 * addressed — the presence of real colleagues, not a transaction id. Hearing
 * the room is what lets an agent hold a conversation instead of posting into a
 * void, while the thread_id keeps the next reply on the same thread.
 */
function describeSend(db: DatabaseSync, selfAgentId: string, channel: string, spaceId: string, messageId: string, threadId: string): string {
  const addressed = mentionedTeammates(db, selfAgentId, messageId);
  const present = channelTeammates(db, selfAgentId, spaceId, addressed);
  const lines = [`Your message is up in #${channel}.`];
  if (addressed.length > 0) lines.push(`${joinNames(addressed)} can see it and reply here.`);
  if (present.length > 0) lines.push(`Also in the room: ${joinNames(present)}.`);
  lines.push(`To stay in this conversation, reply with thread_id="${threadId}".`);
  return lines.join(" ");
}

function mentionedTeammates(db: DatabaseSync, selfAgentId: string, messageId: string): string[] {
  const rows = db.prepare(`
    select coalesce(a.name, e.display_name) as name
    from chat_mentions m
    left join agents a on a.id = m.target_id and m.target_type = 'agent'
    left join employees e on e.id = m.target_id and m.target_type = 'employee'
    where m.message_id = ? and m.target_type in ('agent', 'employee') and m.target_id <> ?
  `).all(messageId, selfAgentId) as Array<{ name: string | null }>;
  return dedupeNames(rows);
}

function channelTeammates(db: DatabaseSync, selfAgentId: string, spaceId: string, addressed: string[]): string[] {
  const alreadyNamed = new Set(addressed);
  const rows = db.prepare(`
    select coalesce(a.name, e.display_name) as name
    from chat_memberships cm
    left join agents a on a.id = cm.principal_id and cm.principal_type = 'agent'
    left join employees e on e.id = cm.principal_id and cm.principal_type = 'employee'
    where cm.space_id = ? and cm.principal_id <> ?
  `).all(spaceId, selfAgentId) as Array<{ name: string | null }>;
  return dedupeNames(rows).filter((name) => !alreadyNamed.has(name)).slice(0, 6);
}

function dedupeNames(rows: Array<{ name: string | null }>): string[] {
  const names = new Set<string>();
  for (const row of rows) if (row.name) names.add(row.name);
  return [...names];
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function createDocumentTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const title = requireString(args.title, "title");
  const docType = requireString(args.doc_type, "doc_type");
  const content = requireString(args.content, "content");
  const documentService = new DocumentService(deps.db);
  const docId = documentService.create({
    orgId: ctx.orgId,
    title,
    docType,
    content,
    authorAgentId: ctx.agent.id,
    reviewerAgentId: null,
    projectId: ctx.taskProjectId,
    goalId: ctx.taskGoalId,
    taskId: null,
  });
  return `Created document "${title}" (doc_id=${docId}, type=${docType}, chars=${content.length}).`;
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
  const channel = assignmentChannel(input.assignee.department);
  const body = [
    `@${canonicalMentionHandle(input.assignee.name)} take task_id=${input.taskId}: ${input.title}.`,
    input.description,
  ].join(" ");
  const space = deps.db.prepare(
    "select id from chat_spaces where org_id = ? and lower(name) = lower(?) and space_type <> 'direct' limit 1",
  ).get(ctx.orgId, channel) as { id: string } | undefined;
  if (!space) throw new Error(`No channel named "${channel}".`);
  const messageId = deps.chat.sendMessage({
    orgId: ctx.orgId,
    spaceId: space.id,
    threadId: null,
    senderType: "agent",
    senderId: ctx.agent.id,
    bodyMd: body,
    attachmentFileIds: [],
  });
  const row = deps.db.prepare("select thread_id from chat_messages where id = ?").get(messageId) as { thread_id: string };
  return row.thread_id;
}

function assignmentChannel(department: string): string {
  const normalized = department.trim().toLowerCase();
  if (normalized === "engineering" || normalized === "product") return normalized;
  return "general";
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

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`"${field}" is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`"${field}" must be an array.`);
  return value.map((item, index) => requireString(item, `${field}[${index}]`));
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
