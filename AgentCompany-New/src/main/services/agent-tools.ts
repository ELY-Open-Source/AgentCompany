import type { DatabaseSync } from "node:sqlite";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS, type RiskLevel } from "../../shared/domain";
import { ORGANIZATION_DEPARTMENTS } from "./org-governance-service";
import type { OrganizationService } from "./organization-service";
import type { ChatService } from "./chat-service";
import { writeDeliverable } from "./deliverable-writer";
import { DocumentService } from "./document-service";
import { recordWorkspaceFile } from "./files/file-object-store";
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
    description: "Post a coordination message to a company channel so teammates and the operator can follow the work. Use @mentions for teammates, attach deliverable file ids with attachment_file_ids, and use /handoff @Name when passing a file. Use the channel that matches the work: 'engineering' for engineering, 'product' for product/design, otherwise 'general'. Reply inside a thread by passing its thread_id.",
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
  {
    name: "finish",
    description: "End your turn. Call this ONLY after you have taken every action this task needs — for a kickoff that means hiring your team, delegating their first tasks, and posting a kickoff message to a channel. Do not call it just to stop early.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
];

/** Control tool that ends an agent's turn; the run loop consumes it, never dispatched. */
export const FINISH_TOOL = "finish";

export function dispatchAgentTool(deps: AgentToolDeps, ctx: AgentToolContext, call: ToolCall): string {
  try {
    switch (call.name) {
      case "hire_agent":
        return hireAgent(deps, ctx, call.arguments);
      case "create_task":
        return createTask(deps, ctx, call.arguments);
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

function createTask(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const title = requireString(args.title, "title");
  const description = requireString(args.description, "description");
  const assigneeName = optionalString(args.assignee_agent_name);
  const assigneeId = assigneeName ? resolveAgentByName(deps.db, ctx.orgId, assigneeName) : null;
  if (assigneeName && !assigneeId) throw new Error(`No agent named "${assigneeName}" — hire them first.`);
  const taskId = deps.organization.createTask({
    orgId: ctx.orgId,
    title,
    description,
    status: TASK_STATUS.BACKLOG,
    assigneeAgentId: assigneeId,
    risk: normalizeRisk(args.risk),
    projectId: ctx.taskProjectId,
    goalId: ctx.taskGoalId,
    workspaceId: ctx.workspace?.id ?? null,
    priority: TASK_PRIORITY.NORMAL,
    requiresFilesystem: false,
  });
  return `Created task "${title}" (task_id=${taskId})${assigneeId ? ` assigned to ${assigneeName}` : " (unassigned)"}.`;
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
  return `Posted to #${channel} (message_id=${messageId}, thread_id=${row.thread_id}).`;
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

function resolveAgentByName(db: DatabaseSync, orgId: string, name: string): string | null {
  const row = db.prepare("select id from agents where org_id = ? and lower(name) = lower(?) and lifecycle = 'active' limit 1")
    .get(orgId, name.trim()) as { id: string } | undefined;
  return row?.id ?? null;
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
