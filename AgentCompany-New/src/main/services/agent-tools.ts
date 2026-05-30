import type { DatabaseSync } from "node:sqlite";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS, type RiskLevel } from "../../shared/domain";
import type { OrganizationService } from "./organization-service";
import { writeDeliverable } from "./deliverable-writer";
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
        department: { type: "string", description: "Department, e.g. 'Marketing' or 'Operations'." },
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
];

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
  const content = typeof args.content === "string" ? args.content : "";
  const written = writeDeliverable({ workspaceRoot: ctx.workspace.localPath, relativePath: path, content });
  recordWorkspaceFile(deps.db, {
    orgId: ctx.orgId,
    ownerType: "agent",
    ownerId: ctx.agent.id,
    workspaceRoot: ctx.workspace.localPath,
    relativePath: written,
  });
  return `Wrote deliverable ${written} (${content.length} chars).`;
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
