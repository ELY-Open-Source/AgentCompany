import type { AgentTurnMessage } from "./provider-tool-turn";

const KEEP_RECENT_TOOL_TURNS = 3;
const ELIDE_ABOVE_CHARS = 600;
const PREVIEW_CHARS = 300;

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
  return { messages: compacted, elided };
}
