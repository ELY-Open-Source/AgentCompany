import type { ProviderService } from "./provider-service";
import { AGENT_TOOLS, dispatchAgentTool, type AgentToolContext, type AgentToolDeps } from "./agent-tools";
import { completeGoalTool } from "./agent-goal-tools";
import { executeWebTool, isWebTool, WEB_TOOLS } from "./agent-web-tools";
import { executeWorkspaceTool, isWorkspaceTool, WORKSPACE_TOOLS } from "./agent-workspace-tools";
import { canonicalMentionHandle } from "../../shared/mention-handles";
import type { AgentTurnMessage, AgentTurnResult, ToolCall, ToolDefinition } from "./provider-tool-turn";
import { isComposioTool, executeComposioTool } from "./composio/composio-tool-bridge";
import { capToolOutput, compactToolHistory } from "./run-context-compaction";
import { fitContextBudget } from "./context-budget";
import { MAX_TOOL_CALLS_PER_TURN, throwIfRunStopped, untilStopped } from "./run-control";

const MAX_ITERATIONS = 12;
/** Each goal audit runs its own model loop, so a session gets only a couple. */
const MAX_GOAL_AUDITS_PER_SESSION = 2;
const STEP_LIMIT_TEXT = "I used this session's steps and will continue in the next one.";

export interface AgentRunLoopInput {
  orgId: string;
  providerId: string;
  workspaceId: string | null;
  instructions: string;
  initialUserTurn: string;
  toolContext: AgentToolContext;
  externalTools?: ToolDefinition[];
  /** Messages that arrived mid-run, or null. */
  pollNewMessages?: () => string | null;
  /** Called after each model turn the provider answered, with that turn. */
  onModelTurn?: (turn: AgentTurnResult) => void;
  /** Called with every executed tool call and its full output. */
  onToolCompleted?: (call: ToolCall, output: string) => void;
  /** Input tokens the provider's context window leaves after the output reserve. */
  inputBudgetTokens: number;
}

export interface AgentRunLoopResult {
  finalText: string;
  iterations: number;
  toolCallCount: number;
  lastRequestId: string;
  /** The session was still working when it reached the step limit; the task continues next session. */
  hitStepLimit: boolean;
}

export interface AgentRunLoopDeps {
  providers: Pick<ProviderService, "runToolTurn" | "integrationKeys">;
  tools: AgentToolDeps;
  /** Called after each iteration's tool calls have written their effects. */
  onToolResults?: () => void;
}

/** Every tool the model can call in a run. */
export function runTools(externalTools: ToolDefinition[]): ToolDefinition[] {
  return [...AGENT_TOOLS, ...WORKSPACE_TOOLS, ...WEB_TOOLS, ...externalTools];
}

/** Runs the model with the agent tools until it stops calling them; step, time, tool-call and audit limits end it as a checkpoint or refuse the excess. */
export async function runAgentLoop(deps: AgentRunLoopDeps, input: AgentRunLoopInput): Promise<AgentRunLoopResult> {
  const allTools = runTools(input.externalTools ?? []);
  const messages: AgentTurnMessage[] = [{ role: "user", text: input.initialUserTurn }];
  let toolCallCount = 0;
  let lastRequestId = "";
  let lastText = "";
  let goalAudits = 0;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const compaction = compactToolHistory(messages);
    if (compaction.elided > 0) {
      messages.splice(0, messages.length, ...compaction.messages);
      console.info(`[run-loop] iteration ${iteration}: elided ${compaction.elided} earlier tool result(s)`);
    }
    fitContextBudget(input.instructions, messages, allTools, input.inputBudgetTokens, iteration);
    throwIfRunStopped();
    const turn = await untilStopped(deps.providers.runToolTurn({
      orgId: input.orgId,
      providerId: input.providerId,
      workspaceId: input.workspaceId,
      instructions: input.instructions,
      messages,
      tools: allTools,
    })).catch((error: unknown) => {
      throwIfRunStopped();
      throw error;
    });
    throwIfRunStopped();
    lastRequestId = turn.requestId;
    input.onModelTurn?.(turn);

    if (turn.toolCalls.length === 0) {
      if (toolCallCount === 0 && !turn.text.trim()) {
        // A first turn with neither text nor tool calls means the provider
        // produced nothing actionable (e.g. output truncated mid-reasoning);
        // completing the run would silently mark a no-op as done.
        throw new Error("Provider returned an empty turn: no text and no tool calls.");
      }
      const lateMessages = input.pollNewMessages?.();
      if (lateMessages) {
        messages.push({ role: "assistant", text: turn.text, toolCalls: [], ...(turn.replay ? { replay: turn.replay } : {}) }, { role: "user", text: lateMessages });
        continue;
      }
      return { finalText: turn.text, iterations: iteration, toolCallCount, lastRequestId, hitStepLimit: false };
    }

    lastText = turn.text.trim() || lastText;
    messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls, ...(turn.replay ? { replay: turn.replay } : {}) });
    const results: Array<{ toolCallId: string; toolName: string; output: string }> = [];
    for (const [index, call] of turn.toolCalls.entries()) {
      throwIfRunStopped();
      if (index >= MAX_TOOL_CALLS_PER_TURN) {
        results.push({ toolCallId: call.id, toolName: call.name, output: `ERROR: not run: this turn asked for ${turn.toolCalls.length} tool calls; the limit is ${MAX_TOOL_CALLS_PER_TURN}. Repeat the ones you still need.` });
        continue;
      }
      if (call.name === "complete_goal" && goalAudits >= MAX_GOAL_AUDITS_PER_SESSION) {
        results.push({ toolCallId: call.id, toolName: call.name, output: `ERROR: this session already ran ${MAX_GOAL_AUDITS_PER_SESSION} goal audits. Close the gaps they named, then try again next session.` });
        continue;
      }
      if (call.name === "complete_goal") goalAudits += 1;
      toolCallCount += 1;
      let output: string;
      if (isComposioTool(call.name)) {
        output = await untilStopped(executeComposioTool(deps.tools.db, deps.providers.integrationKeys, input.orgId, input.toolContext.agent.id, call));
      } else if (isWorkspaceTool(call.name)) {
        output = await untilStopped(executeWorkspaceTool(input.toolContext, call));
      } else if (isWebTool(call.name)) {
        output = await untilStopped(executeWebTool(call));
      } else if (call.name === "complete_goal") {
        // Runs an independent audit turn against the provider, so it needs
        // the loop's provider access rather than the sync dispatcher.
        output = await untilStopped(completeGoalTool({
          deps: deps.tools,
          ctx: input.toolContext,
          providers: deps.providers,
          providerId: input.providerId,
          workspaceId: input.workspaceId,
          inputBudgetTokens: input.inputBudgetTokens,
          call,
        }));
      } else {
        output = dispatchAgentTool(deps.tools, input.toolContext, call, {
          announceTaskAssignments: shouldAnnounceTaskAssignment(call, turn.toolCalls),
        });
      }
      input.onToolCompleted?.(call, output);
      results.push({ toolCallId: call.id, toolName: call.name, output: capToolOutput(call.name, output) });
    }
    const followUp = input.pollNewMessages?.();
    messages.push(followUp ? { role: "tool", results, followUp } : { role: "tool", results });
    deps.onToolResults?.();
  }

  // Still working at the limit: end as a checkpoint; the next session picks up from the run journal.
  console.info(`[run-loop] reached the ${MAX_ITERATIONS}-step limit with work in progress; ending the session as a checkpoint`);
  return { finalText: lastText || STEP_LIMIT_TEXT, iterations: MAX_ITERATIONS, toolCallCount, lastRequestId, hitStepLimit: true };
}

function shouldAnnounceTaskAssignment(call: { name: string; arguments: Record<string, unknown> }, toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>): boolean {
  if (call.name !== "create_task") return true;
  const assigneeName = stringArg(call.arguments.assignee_agent_name);
  if (!assigneeName) return true;
  const handle = `@${canonicalMentionHandle(assigneeName)}`;
  return !toolCalls.some((toolCall) => {
    if (toolCall.name !== "send_message") return false;
    return stringArg(toolCall.arguments.body).toLowerCase().includes(handle);
  });
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}
