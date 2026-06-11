import type { ProviderService } from "./provider-service";
import { AGENT_TOOLS, dispatchAgentTool, type AgentToolContext, type AgentToolDeps } from "./agent-tools";
import type { AgentTurnMessage } from "./provider-tool-turn";

const MAX_ITERATIONS = 12;

export interface AgentRunLoopInput {
  orgId: string;
  providerId: string;
  workspaceId: string | null;
  instructions: string;
  initialUserTurn: string;
  toolContext: AgentToolContext;
}

export interface AgentRunLoopResult {
  finalText: string;
  iterations: number;
  toolCallCount: number;
  lastRequestId: string;
}

export interface AgentRunLoopDeps {
  providers: Pick<ProviderService, "runToolTurn">;
  tools: AgentToolDeps;
  /** Called after each iteration's tool calls have written their effects. */
  onToolResults?: () => void;
}

/**
 * Drives a real tool-use loop against the live provider: prompt the model with
 * the agent tools, execute every tool call it makes, feed results back, and
 * repeat until the model returns a turn with no tool calls (it is done) or the
 * iteration cap is hit (which throws rather than silently truncating).
 */
export async function runAgentLoop(deps: AgentRunLoopDeps, input: AgentRunLoopInput): Promise<AgentRunLoopResult> {
  const messages: AgentTurnMessage[] = [{ role: "user", text: input.initialUserTurn }];
  let toolCallCount = 0;
  let lastRequestId = "";

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const turn = await deps.providers.runToolTurn({
      orgId: input.orgId,
      providerId: input.providerId,
      workspaceId: input.workspaceId,
      instructions: input.instructions,
      messages,
      tools: AGENT_TOOLS,
      // Compel a concrete action on the opening turn so even a weak model
      // cannot answer with prose and quietly finish a no-op; once it has acted,
      // let it choose freely (continue working, or stop when done).
      toolChoice: iteration === 1 ? "required" : "auto",
    });
    lastRequestId = turn.requestId;

    if (turn.toolCalls.length === 0) {
      if (iteration === 1) {
        // The opening turn was forced to call a tool. None means the agent took
        // no action at all — fail loudly instead of recording a deceptive
        // "success" that hired no one, delegated nothing, and said nothing.
        throw new Error("Agent took no action on its first turn — the model returned no tool calls.");
      }
      return { finalText: turn.text, iterations: iteration, toolCallCount, lastRequestId };
    }

    messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls });
    const results = turn.toolCalls.map((call) => {
      toolCallCount += 1;
      return { toolCallId: call.id, toolName: call.name, output: dispatchAgentTool(deps.tools, input.toolContext, call) };
    });
    messages.push({ role: "tool", results });
    deps.onToolResults?.();
  }

  throw new Error(`Agent run did not converge within ${MAX_ITERATIONS} iterations.`);
}
