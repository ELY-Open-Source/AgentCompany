import { AuditService } from "./audit-service";
import { executeWorkspaceTool, WORKSPACE_TOOLS } from "./agent-workspace-tools";
import { requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { ProviderService } from "./provider-service";
import type { AgentTurnMessage, ToolCall, ToolDefinition } from "./provider-tool-turn";

const AUDIT_MAX_ITERATIONS = 6;

export const GOAL_TOOLS: ToolDefinition[] = [
  {
    name: "complete_goal",
    description: "Ask to close the goal your current task belongs to as achieved. CEO or the goal's owner only. An independent auditor inspects the workspace before the goal actually closes — scaffolds, plans, and documents about the work do not pass; working results do.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        evidence: {
          type: "string",
          description: "The concrete evidence that the goal is achieved: what exists, where it lives in the workspace, and what verification passed.",
        },
      },
      required: ["evidence"],
    },
  },
];

export interface GoalCompletionArgs {
  deps: AgentToolDeps;
  ctx: AgentToolContext;
  providers: Pick<ProviderService, "runToolTurn">;
  providerId: string;
  workspaceId: string | null;
  call: ToolCall;
}

/**
 * Completion is a claim, not a decision (the pi-goal-x auditor pattern): the
 * executor states evidence, and a fresh model with read-only workspace tools
 * verifies it. The auditor never shares the executor's conversation, so it
 * judges what actually exists rather than what was said to exist. Any outcome
 * other than an explicit approval leaves the goal open.
 */
export async function completeGoalTool(args: GoalCompletionArgs): Promise<string> {
  const { deps, ctx, call } = args;
  try {
    if (!ctx.taskGoalId) return "ERROR: this task is not attached to a goal, so there is nothing to complete.";
    const goal = deps.db.prepare("select id, title, description, status, owner_agent_id from goals where id = ? and org_id = ?")
      .get(ctx.taskGoalId, ctx.orgId) as { id: string; title: string; description: string; status: string; owner_agent_id: string | null } | undefined;
    if (!goal) throw new Error("Goal was not found.");
    const acting = deps.db.prepare("select role_level from agents where id = ? and org_id = ?")
      .get(ctx.agent.id, ctx.orgId) as { role_level: string } | undefined;
    if (acting?.role_level !== "c_suite" && ctx.agent.id !== goal.owner_agent_id) {
      return "ERROR: Only the CEO or the goal's owner can complete a goal. Report your evidence to them instead.";
    }
    if (goal.status !== "active") return `Goal "${goal.title}" is already ${goal.status}.`;
    const evidence = requireString(call.arguments.evidence, "evidence");

    const verdict = await auditGoalCompletion(args, goal, evidence);
    if (!verdict.approved) {
      return `The independent audit rejected closing the goal: ${verdict.reason} The goal stays active — close that gap or create the tasks that will.`;
    }
    deps.db.prepare("update goals set status = 'achieved', updated_at = ? where id = ? and org_id = ?")
      .run(new Date().toISOString(), goal.id, ctx.orgId);
    new AuditService(deps.db).record({
      orgId: ctx.orgId,
      entityType: "goal",
      entityId: goal.id,
      actorType: "agent",
      actorId: ctx.agent.id,
      action: "status_changed",
      payload: { status: "achieved", auditVerdict: verdict.reason },
    });
    return `Goal "${goal.title}" is marked achieved — the independent audit confirmed it (${verdict.reason}). Tell the team.`;
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

interface AuditVerdict {
  approved: boolean;
  reason: string;
}

async function auditGoalCompletion(
  args: GoalCompletionArgs,
  goal: { title: string; description: string },
  evidence: string,
): Promise<AuditVerdict> {
  // Read-only inspection: the auditor may look at anything but change nothing.
  const auditTools = WORKSPACE_TOOLS.filter((tool) => tool.name !== "run_command");
  const auditCtx: AgentToolContext = {
    ...args.ctx,
    workspace: args.ctx.workspace ? { ...args.ctx.workspace, writeAccess: false } : null,
  };
  const messages: AgentTurnMessage[] = [{
    role: "user",
    text: [
      "A goal is claimed complete. Decide whether the claim survives the evidence.",
      `Goal: ${goal.title}`,
      `Goal detail: ${goal.description}`,
      "The executor's claim:",
      evidence,
      "Inspect the workspace with list_files and read_file before deciding. Judge outcomes, not artifacts about outcomes: plans, specs, status reports, and skeletons do not make a goal achieved; working deliverables do. If the goal promises software, look for the actual implementation, not documents describing it.",
      "End your final message with exactly one marker: <approved/> if the goal is genuinely achieved, or <disapproved/> followed by one short sentence naming the decisive gap.",
    ].join("\n\n"),
  }];
  const instructions = "You are the independent completion auditor. You did not do the work and owe its author nothing; your only loyalty is to what actually exists. Be strict: an unverifiable claim is a false claim.";

  for (let iteration = 1; iteration <= AUDIT_MAX_ITERATIONS; iteration += 1) {
    const turn = await args.providers.runToolTurn({
      orgId: args.ctx.orgId,
      providerId: args.providerId,
      workspaceId: args.workspaceId,
      instructions,
      messages,
      tools: auditTools,
    });
    if (turn.toolCalls.length === 0) return parseVerdict(turn.text);
    messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls });
    const results: Array<{ toolCallId: string; toolName: string; output: string }> = [];
    for (const toolCall of turn.toolCalls) {
      results.push({ toolCallId: toolCall.id, toolName: toolCall.name, output: await executeWorkspaceTool(auditCtx, toolCall) });
    }
    messages.push({ role: "tool", results });
  }
  return { approved: false, reason: "the audit did not reach a verdict within its budget, which counts as not achieved" };
}

function parseVerdict(text: string): AuditVerdict {
  const reason = text.replace(/<\/?(approved|disapproved)\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
  if (/<approved\s*\/>/i.test(text)) return { approved: true, reason: reason || "no gaps found" };
  return { approved: false, reason: reason || "the auditor did not state an explicit approval" };
}
