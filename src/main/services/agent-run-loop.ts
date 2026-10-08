import type { ProviderService } from "./provider-service";
import { AGENT_TOOLS, dispatchAgentTool, type AgentToolContext, type AgentToolDeps } from "./agent-tools";
import { completeGoalTool } from "./agent-goal-tools";
import { executeWebTool, isWebTool, WEB_TOOLS } from "./agent-web-tools";
import { executeWorkspaceTool, isWorkspaceTool, WORKSPACE_TOOLS } from "./agent-workspace-tools";
import { canonicalMentionHandle } from "../../shared/mention-handles";
import type { AgentTurnMessage, ToolCall, ToolDefinition } from "./provider-tool-turn";
import { isComposioTool, executeComposioTool } from "./composio/composio-tool-bridge";
import { capToolOutput, compactToolHistory } from "./run-context-compaction";
import { fitContextBudget } from "./context-budget";

const MAX_ITERATIONS = 12;

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
  /** Called after each model turn the provider answered. */
  onModelTurn?: () => void;
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

/**
 * Drives a real tool-use loop against the live provider: prompt the model with
 * the agent tools, execute every tool call it makes, feed results back, and
 * repeat until the model returns a turn with no tool calls (it is done) or the
 * iteration cap is hit (which throws rather than silently truncating).
 */
export async function runAgentLoop(deps: AgentRunLoopDeps, input: AgentRunLoopInput): Promise<AgentRunLoopResult> {
  const allTools = runTools(input.externalTools ?? []);
  const messages: AgentTurnMessage[] = [{ role: "user", text: input.initialUserTurn }];
  let toolCallCount = 0;
  let lastRequestId = "";

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const compaction = compactToolHistory(messages);
    if (compaction.elided > 0) {
      messages.splice(0, messages.length, ...compaction.messages);
      console.info(`[run-loop] iteration ${iteration}: elided ${compaction.elided} earlier tool result(s)`);
    }
    fitContextBudget(input.instructions, messages, allTools, input.inputBudgetTokens, iteration);
    const turn = await deps.providers.runToolTurn({
      orgId: input.orgId,
      providerId: input.providerId,
      workspaceId: input.workspaceId,
      instructions: input.instructions,
      messages,
      tools: allTools,
    });
    lastRequestId = turn.requestId;
    input.onModelTurn?.();

    if (turn.toolCalls.length === 0) {
      if (toolCallCount === 0 && !turn.text.trim()) {
        // A first turn with neither text nor tool calls means the provider
        // produced nothing actionable (e.g. output truncated mid-reasoning);
        // completing the run would silently mark a no-op as done.
        throw new Error("Provider returned an empty turn: no text and no tool calls.");
      }
      const lateMessages = input.pollNewMessages?.();
      if (lateMessages) {
        messages.push({ role: "assistant", text: turn.text, toolCalls: [] }, { role: "user", text: lateMessages });
        continue;
      }
      return { finalText: turn.text, iterations: iteration, toolCallCount, lastRequestId };
    }

    messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls });
    const results: Array<{ toolCallId: string; toolName: string; output: string }> = [];
    for (const call of turn.toolCalls) {
      toolCallCount += 1;
      let output: string;
      if (isComposioTool(call.name)) {
        output = await executeComposioTool(deps.tools.db, deps.providers.integrationKeys, input.orgId, input.toolContext.agent.id, call);
      } else if (isWorkspaceTool(call.name)) {
        output = await executeWorkspaceTool(input.toolContext, call);
      } else if (isWebTool(call.name)) {
        output = await executeWebTool(call);
      } else if (call.name === "complete_goal") {
        // Runs an independent audit turn against the provider, so it needs
        // the loop's provider access rather than the sync dispatcher.
        output = await completeGoalTool({
          deps: deps.tools,
          ctx: input.toolContext,
          providers: deps.providers,
          providerId: input.providerId,
          workspaceId: input.workspaceId,
          inputBudgetTokens: input.inputBudgetTokens,
          call,
        });
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

  throw new Error(`Agent run did not converge within ${MAX_ITERATIONS} iterations.`);
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
