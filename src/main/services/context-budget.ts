import { compactToolHistory } from "./run-context-compaction";
import type { AgentTurnMessage, ToolDefinition } from "./provider-tool-turn";

/** Tokens kept free for the model's answer. */
export const OUTPUT_RESERVE_TOKENS = 16_000;

/** Share of the input budget the compiled skills may take. */
export const SKILL_BUDGET_SHARE = 0.4;

const CJK = /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

/** Conservative: CJK counts one token per character, other text one per three. */
export function estimateTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return cjk + Math.ceil((text.length - cjk) / 3);
}

export function inputBudgetTokens(contextWindowTokens: number): number {
  return contextWindowTokens - OUTPUT_RESERVE_TOKENS;
}

export function skillBudgetTokens(contextWindowTokens: number): number {
  return Math.floor(inputBudgetTokens(contextWindowTokens) * SKILL_BUDGET_SHARE);
}

export /** Shrinks history to fit the window, or fails with the numbers. */
function fitContextBudget(instructions: string, messages: AgentTurnMessage[], tools: ToolDefinition[], budget: number, iteration: number): void {
  const fixed = estimateTokens(instructions) + estimateTokens(JSON.stringify(tools));
  let total = fixed + estimateTokens(JSON.stringify(messages));
  if (total > budget) {
    messages.splice(0, messages.length, ...compactToolHistory(messages, 1).messages);
    const compacted = fixed + estimateTokens(JSON.stringify(messages));
    console.warn(`[run-loop] iteration ${iteration}: ~${total} tokens over the ${budget} budget; aggressive compaction brought it to ~${compacted}`);
    total = compacted;
  }
  if (total > budget) {
    throw new Error(`This run needs ~${total} input tokens but the provider's context window leaves ${budget}. Raise the provider's context window in Settings > Advanced if the model supports more, or split the task.`);
  }
}
