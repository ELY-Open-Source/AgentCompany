import type { ToolTurnFn } from "../provider-tool-turn";
import {
  makeChatCompletionsTurn,
  runAnthropicTurn,
  runAntigravityTurn,
  runAzureTurn,
  runBedrockTurn,
  runClaudeProTurn,
  runCodexTurn,
  runCopilotTurn,
  runCustomAnthropicTurn,
  runCustomOpenAiTurn,
  runKimiCodeTurn,
  runOpenAiResponsesTurn,
  runVertexTurn,
} from "./turns";

/** Provider key -> the tool-use turn function that drives the agent loop. */
const TURNS: Record<string, ToolTurnFn> = {
  openai: runOpenAiResponsesTurn,
  anthropic: runAnthropicTurn,
  xai: makeChatCompletionsTurn("https://api.x.ai/v1/chat/completions", "xAI"),
  groq: makeChatCompletionsTurn("https://api.groq.com/openai/v1/chat/completions", "Groq"),
  mistral: makeChatCompletionsTurn("https://api.mistral.ai/v1/chat/completions", "Mistral"),
  cerebras: makeChatCompletionsTurn("https://api.cerebras.ai/v1/chat/completions", "Cerebras"),
  openrouter: makeChatCompletionsTurn("https://openrouter.ai/api/v1/chat/completions", "OpenRouter"),
  kimi: makeChatCompletionsTurn("https://api.moonshot.ai/v1/chat/completions", "Kimi"),
  "kimi-cn": makeChatCompletionsTurn("https://api.moonshot.cn/v1/chat/completions", "Kimi CN"),
  "gpt-account": runCodexTurn,
  "github-copilot": runCopilotTurn,
  "google-antigravity": runAntigravityTurn,
  "claude-pro": runClaudeProTurn,
  "kimi-code": runKimiCodeTurn,
  "custom-openai": runCustomOpenAiTurn,
  "custom-anthropic": runCustomAnthropicTurn,
  "azure-openai": runAzureTurn,
  "aws-bedrock": runBedrockTurn,
  "vertex-ai": runVertexTurn,
};

export function supportsToolTurn(providerKey: string): boolean {
  return providerKey in TURNS;
}

export function selectToolTurn(providerKey: string): ToolTurnFn {
  const turn = TURNS[providerKey];
  if (!turn) throw new Error(`${providerKey} does not support agent execution.`);
  return turn;
}
