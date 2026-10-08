import type { AgentTurnMessage } from "./provider-tool-turn";

const KEEP_RECENT_TOOL_TURNS = 3;
const ELIDE_ABOVE_CHARS = 600;
const PREVIEW_CHARS = 300;
const TOOL_RESULT_CHAR_LIMIT = 26_000;

/** One tool result never exceeds the per-result cap. */
export function capToolOutput(toolName: string, output: string): string {
  if (output.length <= TOOL_RESULT_CHAR_LIMIT) return output;
  console.warn(`[run-loop] ${toolName} returned ${output.length} chars; cut to ${TOOL_RESULT_CHAR_LIMIT}`);
  return `${output.slice(0, TOOL_RESULT_CHAR_LIMIT)}\n\n[result of ${toolName} cut at ${TOOL_RESULT_CHAR_LIMIT} of ${output.length} characters; ask for less (filters, pagination, fewer fields)]`;
}

/** Older tool results shrink to a preview; the latest turns stay verbatim. */
export function compactToolHistory(messages: AgentTurnMessage[], keepRecent = KEEP_RECENT_TOOL_TURNS): { messages: AgentTurnMessage[]; elided: number } {
  const toolTurnIndexes = messages.flatMap((message, index) => (message.role === "tool" ? [index] : []));
  const compactBefore = toolTurnIndexes.length > keepRecent
    ? toolTurnIndexes[toolTurnIndexes.length - keepRecent]
    : 0;
  let elided = 0;
  const compacted = messages.map((message, index) => {
    if (message.role !== "tool" || index >= compactBefore) return message;
    const results = message.results.map((result) => {
      if (result.output.length <= ELIDE_ABOVE_CHARS || result.output.startsWith("[Earlier result of ")) return result;
      elided += 1;
      return {
        ...result,
        output: `[Earlier result of ${result.toolName} elided to save context (${result.output.length} chars). It began: ${result.output.slice(0, PREVIEW_CHARS)}… Call ${result.toolName} again if you need the full result.]`,
      };
    });
    return { ...message, results };
  });
  const firstRewritten = compacted.findIndex((message, index) => message.role === "tool" && message.results.some((result, at) => result !== (messages[index] as typeof message).results[at]));
  if (firstRewritten < 0) return { messages: compacted, elided };
  // Bedrock's reasoning signature hashes every earlier message, so its turns after a rewrite go back unsigned; Gemini requires its signatures kept.
  const unsigned = compacted.map((message, index) => {
    if (index < firstRewritten || message.role !== "assistant" || message.replay?.format !== "bedrock") return message;
    return { role: message.role, text: message.text, toolCalls: message.toolCalls };
  });
  return { messages: unsigned, elided };
}
