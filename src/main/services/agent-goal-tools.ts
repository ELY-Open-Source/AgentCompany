import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fitContextBudget } from "./context-budget";
import { AuditService } from "./audit-service";
import { executeWorkspaceTool, WORKSPACE_TOOLS } from "./agent-workspace-tools";
import { optionalString, requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { JsonRecord } from "./provider-http";
import type { ProviderService } from "./provider-service";
import { unreadableArguments, type AgentTurnMessage, type ToolCall, type ToolDefinition } from "./provider-tool-turn";
import { MAX_TOOL_CALLS_PER_TURN, throwIfRunStopped, untilStopped } from "./run-control";
import { heldWorkTitles } from "./held-deliverables";
import { AuditBasis, goalAuditor, resultPointers, unfinishedGoalTasks, type GoalAuditor, type ResultPointers } from "./goal-audit-inputs";
import { DOCUMENT_TOOLS, listDocumentsTool, readDocumentTool } from "./agent-document-tools";

const AUDIT_MAX_ITERATIONS = 6;
const AUDIT_DOCUMENT_TOOLS = new Set(["list_documents", "read_document"]);
const UNREAD_APPROVAL = "You approved without reading any evidence. Open the work itself with read_file or read_document, then decide again.";
const STATUS_TASK_LINES = 8;

export const GOAL_TOOLS: ToolDefinition[] = [
  {
    name: "company_status",
    description:
      "Company-wide progress snapshot: every goal with its task counts, work in flight, recent completions, and team headcount. Officers only. Pull this before reporting progress to the founder so you answer from live data, and use its goal_id values with update_goal.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "update_goal",
    description:
      "Rewrite an active goal's title and/or description when the founder redirects the company — revised direction, scope, tech stack, or market focus. CEO or the goal's owner only. Goal ids come from company_status.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        goal_id: { type: "string", description: "The goal to change." },
        title: { type: "string", description: "The new goal title. Omit to keep the current one." },
        description: { type: "string", description: "The new goal description. Omit to keep the current one." },
      },
      required: ["goal_id"],
    },
  },
  {
    name: "complete_goal",
    description: "Ask to close the goal your current task belongs to as achieved. CEO or the goal's owner only. An independent auditor inspects the workspace before the goal actually closes — scaffolds, plans, and documents about the work do not pass; working results do.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        files: { type: "array", items: { type: "string" }, description: "Workspace paths of the files that hold the result." },
        documents: { type: "array", items: { type: "string" }, description: "Doc ids of the documents that hold the result." },
      },
      required: [],
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
    if (!actorIsCeoOrGoalOwner(deps, ctx, goal.owner_agent_id)) {
      return "ERROR: Only the CEO or the goal's owner can complete a goal. Point them to your result instead.";
    }
    if (goal.status !== "active") return `Goal "${goal.title}" is already ${goal.status}.`;
    if (heldWorkTitles(deps.db, { goalId: goal.id }).length > 0) return heldGoalRefusal(deps, goal);
    const unfinished = unfinishedGoalTasks(deps.db, goal.id, ctx.taskId);
    if (unfinished.length > 0) return unfinishedRefusal(goal, unfinished);
    const pointers = resultPointers(deps.db, ctx, call.arguments);
    const auditor = goalAuditor(deps.db, ctx, args.providerId);
    const basis = new AuditBasis(deps.db, goal.id, ctx.workspace?.localPath ?? null, pointers);

    const verdict = await auditGoalCompletion(args, goal, pointers, auditor, basis);
    if (!verdict.approved) {
      return `The independent audit rejected closing the goal: ${verdict.reason} The goal stays active — close that gap or create the tasks that will.`;
    }
    throwIfRunStopped();
    // Work held for review, tasks opened, or the goal or result changed while the audit ran: the verdict no longer covers what exists.
    if (heldWorkTitles(deps.db, { goalId: goal.id }).length > 0) return heldGoalRefusal(deps, goal);
    const openedMeanwhile = unfinishedGoalTasks(deps.db, goal.id, ctx.taskId);
    if (openedMeanwhile.length > 0) return unfinishedRefusal(goal, openedMeanwhile);
    const edited = basis.editedInCopy();
    if (edited.length > 0) {
      return `ERROR: The auditor's commands changed ${edited.slice(0, 5).join(", ")} in its copy of the workspace, so its verdict is not about the real work; call complete_goal again.`;
    }
    if (basis.changed()) {
      return "ERROR: The goal or the result it points to changed during the audit; call complete_goal again so the audit judges what exists now.";
    }
    deps.db.prepare("update goals set status = 'achieved', stalled_reason = null, updated_at = ? where id = ? and org_id = ?")
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

function unfinishedRefusal(goal: { title: string }, titles: string[]): string {
  return `ERROR: Goal "${goal.title}" still has unfinished tasks (${titles.join(", ")}); finish or close them first.`;
}

function heldGoalRefusal(deps: GoalCompletionArgs["deps"], goal: { id: string; title: string }): string {
  const held = heldWorkTitles(deps.db, { goalId: goal.id });
  return `ERROR: Goal "${goal.title}" has work awaiting board review (${held.join(", ")}); it is not written yet, so the goal cannot be achieved.`;
}

interface AuditVerdict {
  approved: boolean;
  reason: string;
}

async function auditGoalCompletion(
  args: GoalCompletionArgs,
  goal: { title: string; description: string },
  pointers: ResultPointers,
  auditor: GoalAuditor,
  basis: AuditBasis,
): Promise<AuditVerdict> {
  const workspace = args.ctx.workspace;
  // With the operator's file-access approval the auditor may build and test, but only in a throwaway copy.
  const scratch = workspace?.writeAccess ? copyWorkspace(workspace.localPath) : null;
  try {
    if (scratch) basis.auditInCopy(scratch);
    const auditWorkspace = workspace ? { ...workspace, localPath: scratch ?? workspace.localPath, writeAccess: scratch !== null } : null;
    return await runAudit(args, goal, pointers, auditor, basis, auditWorkspace);
  } finally {
    if (scratch) {
      basis.closeCopy();
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

function copyWorkspace(root: string): string {
  const scratch = mkdtempSync(join(tmpdir(), "ac-audit-"));
  try {
    cpSync(root, scratch, { recursive: true });
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
  console.info(`[goal-audit] auditing in a copy of ${root} at ${scratch}`);
  return scratch;
}

async function runAudit(
  args: GoalCompletionArgs,
  goal: { title: string; description: string },
  pointers: ResultPointers,
  auditor: GoalAuditor,
  basis: AuditBasis,
  workspace: AgentToolContext["workspace"],
): Promise<AuditVerdict> {
  const canRun = workspace?.writeAccess === true;
  // The workspace (or its throwaway copy) and the library; nothing the auditor does reaches the real work.
  const auditTools = [
    ...WORKSPACE_TOOLS.filter((tool) => canRun || tool.name !== "run_command"),
    ...DOCUMENT_TOOLS.filter((tool) => AUDIT_DOCUMENT_TOOLS.has(tool.name)),
  ];
  let evidenceRead = false;
  const auditCtx: AgentToolContext = { ...args.ctx, workspace };
  const messages: AgentTurnMessage[] = [{
    role: "user",
    text: [
      "A goal is claimed complete. Decide whether the claim survives the evidence.",
      `Goal: ${goal.title}`,
      `Goal detail: ${goal.description}`,
      // The executor's own account of the work is never shown: only where the result lives.
      "The executor points to these as the result. Verify them yourself:",
      `Files: ${pointers.files.length > 0 ? pointers.files.join(", ") : "none"}`,
      `Documents: ${pointers.documents.length > 0 ? pointers.documents.map((doc) => `${doc.title} (doc_id=${doc.id})`).join(", ") : "none"}`,
      `Inspect the work before deciding: list_files and read_file for the workspace, list_documents and read_document for the library. An approval counts only after you have read some of it. ${canRun ? "run_command runs in a throwaway copy of the workspace: build and run the tests yourself instead of trusting claims that they pass; nothing you do there reaches the real workspace. Never edit the work there: if your commands change any file that was already in the workspace, the verdict is void." : "You cannot run commands here, so a claim that something was run or passes is unverified unless the workspace holds its results."} Judge outcomes, not artifacts about outcomes: plans, specs, status reports, and skeletons do not make a goal achieved; working deliverables do. If the goal promises software, look for the actual implementation, not documents describing it.`,
      "Keep your reasoning apart from your decision. End your final message with the decision alone on its last line: <approved/> by itself if the goal is genuinely achieved, or <disapproved/> followed by one short sentence naming the decisive gap. Use no marker anywhere else.",
    ].join("\n\n"),
  }];
  const instructions = "You are the independent completion auditor. You did not do the work and owe its author nothing; your only loyalty is to what actually exists. Be strict: an unverifiable claim is a false claim.";

  for (let iteration = 1; iteration <= AUDIT_MAX_ITERATIONS; iteration += 1) {
    fitContextBudget(instructions, messages, auditTools, auditor.inputBudgetTokens, iteration);
    throwIfRunStopped();
    const turn = await untilStopped(args.providers.runToolTurn({
      orgId: args.ctx.orgId,
      providerId: auditor.providerId,
      model: auditor.model,
      workspaceId: args.workspaceId,
      instructions,
      messages,
      tools: auditTools,
    }));
    if (turn.toolCalls.length === 0) {
      const verdict = parseVerdict(turn.text);
      if (!verdict.approved || evidenceRead) return verdict;
      // An approval reached without opening anything is not a judgment of the work; the auditor must look first.
      messages.push({ role: "assistant", text: turn.text, toolCalls: [], ...(turn.replay ? { replay: turn.replay } : {}) }, { role: "user", text: UNREAD_APPROVAL });
      continue;
    }
    messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls, ...(turn.replay ? { replay: turn.replay } : {}) });
    const results: Array<{ toolCallId: string; toolName: string; output: string }> = [];
    for (const [index, toolCall] of turn.toolCalls.entries()) {
      throwIfRunStopped();
      const output = index >= MAX_TOOL_CALLS_PER_TURN
        ? `ERROR: not run: this turn asked for ${turn.toolCalls.length} tool calls; the limit is ${MAX_TOOL_CALLS_PER_TURN}.`
        : toolCall.argumentsError ? unreadableArguments(toolCall) : await runAuditTool(args.deps, auditCtx, toolCall);
      if (readsEvidence(toolCall) && !output.startsWith("ERROR")) {
        evidenceRead = true;
        if (toolCall.name === "read_file") basis.noteFile(String(toolCall.arguments.path));
        else basis.noteDocument(String(toolCall.arguments.doc_id));
      }
      results.push({ toolCallId: toolCall.id, toolName: toolCall.name, output });
    }
    messages.push({ role: "tool", results });
  }
  return { approved: false, reason: "the audit did not reach a verdict within its budget, which counts as not achieved" };
}

/** Whether a call opens the work itself; listings and a document's version history do not. */
function readsEvidence(call: ToolCall): boolean {
  return call.name === "read_file" || (call.name === "read_document" && call.arguments.history !== true);
}

async function runAuditTool(deps: AgentToolDeps, ctx: AgentToolContext, call: ToolCall): Promise<string> {
  if (!AUDIT_DOCUMENT_TOOLS.has(call.name)) return untilStopped(executeWorkspaceTool(ctx, call));
  try {
    return call.name === "read_document" ? readDocumentTool(deps, ctx, call.arguments) : listDocumentsTool(deps, ctx, call.arguments);
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Approved only when the last line is <approved/> alone and no other marker appears; quoted, indented or hedged markers do not count. */
function parseVerdict(text: string): AuditVerdict {
  const markers = text.match(/<\/?\s*(approved|disapproved)\s*\/?>/gi) ?? [];
  const reason = text.replace(/<\/?\s*(approved|disapproved)\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
  const lastLine = text.split("\n").map((line) => line.trimEnd()).filter(Boolean).at(-1);
  if (markers.length === 1 && lastLine === "<approved/>") return { approved: true, reason: reason || "no gaps found" };
  if (markers.some((marker) => /disapproved/i.test(marker))) return { approved: false, reason: reason || "the auditor disapproved without a reason" };
  return { approved: false, reason: reason ? `${reason} (no <approved/> alone on the last line)` : "the auditor did not end with <approved/> alone on the last line" };
}

function actorIsCeoOrGoalOwner(deps: AgentToolDeps, ctx: AgentToolContext, ownerAgentId: string | null): boolean {
  const acting = deps.db.prepare("select role_level from agents where id = ? and org_id = ?")
    .get(ctx.agent.id, ctx.orgId) as { role_level: string } | undefined;
  return acting?.role_level === "c_suite" || ctx.agent.id === ownerAgentId;
}

/**
 * Direction changes are first-class: when the founder redirects the company in
 * chat, the CEO rewrites the goal itself instead of narrating the change into
 * a message nobody executes. Tasks keep pointing at the same goal id, so work
 * in flight follows the new wording.
 */
export function updateGoalTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const goalId = requireString(args.goal_id, "goal_id");
  const title = optionalString(args.title);
  const description = optionalString(args.description);
  if (!title && !description) throw new Error("Provide a new title and/or description — nothing to change.");
  const goal = deps.db.prepare("select id, title, description, status, owner_agent_id from goals where id = ? and org_id = ?")
    .get(goalId, ctx.orgId) as { id: string; title: string; description: string; status: string; owner_agent_id: string | null } | undefined;
  if (!goal) throw new Error(`Goal ${goalId} was not found — pull company_status for current goal ids.`);
  if (!actorIsCeoOrGoalOwner(deps, ctx, goal.owner_agent_id)) {
    return "ERROR: Only the CEO or the goal's owner can update a goal. Bring the request to them instead.";
  }
  if (goal.status !== "active") return `Goal "${goal.title}" is ${goal.status}; only active goals can be updated.`;
  const nextTitle = title ?? goal.title;
  const nextDescription = description ?? goal.description;
  deps.db.prepare("update goals set title = ?, description = ?, updated_at = ? where id = ? and org_id = ?")
    .run(nextTitle, nextDescription, new Date().toISOString(), goal.id, ctx.orgId);
  new AuditService(deps.db).record({
    orgId: ctx.orgId,
    entityType: "goal",
    entityId: goal.id,
    actorType: "agent",
    actorId: ctx.agent.id,
    action: "updated",
    payload: { previousTitle: goal.title, title: nextTitle, descriptionChanged: description !== null },
  });
  const renamed = nextTitle !== goal.title ? ` (was "${goal.title}")` : "";
  return `Goal updated: "${nextTitle}"${renamed}. Tell the team what changed and re-point their tasks if the new direction demands it.`;
}

/**
 * The founder asks "how are we doing" in chat; the answer must come from the
 * live board, not the model's memory of it. Wake tasks and goal-review
 * checkpoints (tasks.origin != null) are bookkeeping, not product — they stay
 * out of every count here.
 */
export function companyStatusTool(deps: AgentToolDeps, ctx: AgentToolContext): string {
  const acting = deps.db.prepare("select role_level from agents where id = ? and org_id = ?")
    .get(ctx.agent.id, ctx.orgId) as { role_level: string } | undefined;
  if (acting?.role_level !== "c_suite") {
    return "ERROR: Only company officers can pull the company-wide status. Ask the CEO for a progress report instead.";
  }

  const goals = deps.db.prepare(`
    select g.id, g.title, g.status, a.name as owner_name
    from goals g
    left join agents a on a.id = g.owner_agent_id
    where g.org_id = ?
    order by case g.status when 'active' then 0 else 1 end, g.created_at asc
  `).all(ctx.orgId) as Array<{ id: string; title: string; status: string; owner_name: string | null }>;
  const perGoal = new Map<string, Map<string, number>>();
  const rows = deps.db.prepare(`
    select goal_id, status, count(*) as count
    from tasks
    where org_id = ? and origin is null and goal_id is not null
    group by goal_id, status
  `).all(ctx.orgId) as Array<{ goal_id: string; status: string; count: number }>;
  for (const row of rows) {
    const byStatus = perGoal.get(row.goal_id) ?? new Map<string, number>();
    byStatus.set(row.status, row.count);
    perGoal.set(row.goal_id, byStatus);
  }

  const totals = new Map<string, number>();
  for (const row of deps.db.prepare("select status, count(*) as count from tasks where org_id = ? and origin is null group by status")
    .all(ctx.orgId) as Array<{ status: string; count: number }>) {
    totals.set(row.status, row.count);
  }
  const inFlight = deps.db.prepare(`
    select t.title, t.status, a.name as assignee_name
    from tasks t
    left join agents a on a.id = t.assignee_agent_id
    where t.org_id = ? and t.origin is null and t.status in ('in_progress', 'review')
    order by t.updated_at desc
    limit ${STATUS_TASK_LINES}
  `).all(ctx.orgId) as Array<{ title: string; status: string; assignee_name: string | null }>;
  const recentlyDone = deps.db.prepare(`
    select t.title, t.updated_at, a.name as assignee_name
    from tasks t
    left join agents a on a.id = t.assignee_agent_id
    where t.org_id = ? and t.origin is null and t.status = 'done'
    order by t.updated_at desc
    limit ${STATUS_TASK_LINES}
  `).all(ctx.orgId) as Array<{ title: string; updated_at: string; assignee_name: string | null }>;
  const team = deps.db.prepare(`
    select department, count(*) as count
    from agents
    where org_id = ? and lifecycle = 'active'
    group by department
    order by count desc, department asc
  `).all(ctx.orgId) as Array<{ department: string; count: number }>;

  const count = (status: string) => totals.get(status) ?? 0;
  const taskTotal = [...totals.values()].reduce((sum, value) => sum + value, 0);
  const lines: string[] = [`Company status — ${new Date().toISOString().slice(0, 10)}`, "", "Goals:"];
  if (goals.length === 0) lines.push("- none yet");
  for (const goal of goals) {
    const byStatus = perGoal.get(goal.id);
    const goalCount = (status: string) => byStatus?.get(status) ?? 0;
    lines.push(
      `- [${goal.status}] "${goal.title}" (goal_id=${goal.id}, owner: ${goal.owner_name ?? "unassigned"}) — ` +
      `${goalCount("backlog")} backlog, ${goalCount("in_progress") + goalCount("review")} in flight, ${goalCount("done")} done`,
    );
  }
  lines.push(
    "",
    `Real work tasks: ${taskTotal} total — ${count("backlog")} backlog, ${count("in_progress")} in progress, ${count("review")} in review, ${count("done")} done`,
  );
  if (inFlight.length > 0) {
    lines.push("In flight:");
    for (const task of inFlight) lines.push(`- "${task.title}" — ${task.status}, ${task.assignee_name ?? "unassigned"}`);
  }
  if (recentlyDone.length > 0) {
    lines.push(`Recently completed (latest ${recentlyDone.length}):`);
    for (const task of recentlyDone) lines.push(`- "${task.title}" — done ${task.updated_at.slice(0, 10)}, ${task.assignee_name ?? "unassigned"}`);
  }
  const teamTotal = team.reduce((sum, row) => sum + row.count, 0);
  lines.push("", `Team: ${teamTotal} active agents (${team.map((row) => `${row.department} ${row.count}`).join(", ") || "none"})`);
  return lines.join("\n");
}
