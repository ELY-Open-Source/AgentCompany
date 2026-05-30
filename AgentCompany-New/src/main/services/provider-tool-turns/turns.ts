/**
 * Per-backend tool-use turn functions. Each takes the normalized
 * {@link ProviderToolTurnInput} (with a resolved credential) and returns an
 * {@link AgentTurnResult}. Faithful ports of Pi's provider request handlers.
 */
import { release as osRelease, arch as osArch, platform as osPlatform } from "node:os";
import { postEventStream, postJson, type JsonRecord } from "../provider-http";
import type { AgentTurnMessage, AgentTurnResult, ProviderToolTurnInput, TurnCredential } from "../provider-tool-turn";
import { accumulateResponsesStream, parseResponsesOutput, responsesToolDefs, toResponsesInput } from "./responses-format";
import { anthropicToolDefs, parseAnthropicContent, toAnthropicMessages } from "./anthropic-format";
import { chatToolDefs, parseChatChoice, toChatMessages } from "./chat-format";
import { accumulateGeminiStream, antigravityRequestBody } from "./gemini-format";
import { COPILOT_HEADERS, copilotBaseUrl } from "../oauth/github-copilot-flow";

const ANTIGRAVITY_VERSION = "1.21.9";
const ANTIGRAVITY_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

function requireApiKey(credential: TurnCredential, label: string): string {
  if (!credential.apiKey) throw new Error(`${label} requires an API key.`);
  return credential.apiKey;
}

function requireAccessToken(credential: TurnCredential, label: string): string {
  if (!credential.accessToken) throw new Error(`${label} requires a signed-in access token.`);
  return credential.accessToken;
}

function lastMessageIsUser(messages: AgentTurnMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last?.role === "user";
}

// ---- OpenAI Responses (api key) ----

export async function runOpenAiResponsesTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const body: JsonRecord = {
    model: input.model,
    input: toResponsesInput(input.messages),
    tools: responsesToolDefs(input.tools),
    tool_choice: "auto",
    store: false,
    ...(input.instructions ? { instructions: input.instructions } : {}),
  };
  const response = await postJson("https://api.openai.com/v1/responses", { authorization: `Bearer ${requireApiKey(input.credential, "OpenAI")}` }, body);
  const parsed = parseResponsesOutput(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data) };
}

// ---- OpenAI Chat Completions (xAI, Groq, Mistral, Cerebras, OpenRouter) ----

export function makeChatCompletionsTurn(endpoint: string, label: string): (input: ProviderToolTurnInput) => Promise<AgentTurnResult> {
  return async (input) => {
    const body: JsonRecord = {
      model: input.model,
      messages: toChatMessages(input.instructions, input.messages),
      tools: chatToolDefs(input.tools),
      tool_choice: "auto",
      stream: false,
    };
    const response = await postJson(endpoint, { authorization: `Bearer ${requireApiKey(input.credential, label)}` }, body);
    const parsed = parseChatChoice(response.data);
    return { ...parsed, rawResponseJson: JSON.stringify(response.data) };
  };
}

// ---- Anthropic Messages (api key) ----

export async function runAnthropicTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const body: JsonRecord = {
    model: input.model,
    max_tokens: 4096,
    tools: anthropicToolDefs(input.tools),
    messages: toAnthropicMessages(input.messages),
    ...(input.instructions ? { system: input.instructions } : {}),
  };
  const response = await postJson("https://api.anthropic.com/v1/messages", { "x-api-key": requireApiKey(input.credential, "Anthropic"), "anthropic-version": "2023-06-01" }, body);
  const parsed = parseAnthropicContent(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data) };
}

// ---- Claude Pro/Max (OAuth subscription) ----

export async function runClaudeProTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const system: unknown[] = [
    { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
    ...(input.instructions ? [{ type: "text", text: input.instructions }] : []),
  ];
  const body: JsonRecord = {
    model: input.model,
    max_tokens: 4096,
    tools: anthropicToolDefs(input.tools),
    messages: toAnthropicMessages(input.messages),
    system,
  };
  const response = await postJson("https://api.anthropic.com/v1/messages", {
    authorization: `Bearer ${requireAccessToken(input.credential, "Claude Pro")}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14",
    "anthropic-dangerous-direct-browser-access": "true",
    "user-agent": "claude-cli/2.1.75",
    "x-app": "cli",
  }, body);
  const parsed = parseAnthropicContent(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data) };
}

// ---- GPT account / OpenAI Codex (OAuth, SSE) ----

export async function runCodexTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const access = requireAccessToken(input.credential, "GPT account");
  if (!input.credential.accountId) throw new Error("GPT account credential is missing its account id.");
  const body: JsonRecord = {
    model: input.model,
    store: false,
    stream: true,
    ...(input.instructions ? { instructions: input.instructions } : {}),
    input: toResponsesInput(input.messages),
    text: { verbosity: "medium" },
    include: ["reasoning.encrypted_content"],
    tool_choice: "auto",
    parallel_tool_calls: true,
    tools: responsesToolDefs(input.tools, null),
  };
  const response = await postEventStream(`${CODEX_BASE_URL}/codex/responses`, {
    Authorization: `Bearer ${access}`,
    "chatgpt-account-id": input.credential.accountId,
    originator: "agentcompany",
    "User-Agent": `agentcompany (${osPlatform()} ${osRelease()}; ${osArch()})`,
    "OpenAI-Beta": "responses=experimental",
  }, body);
  return accumulateResponsesStream(response.messages);
}

// ---- GitHub Copilot (OAuth, openai-responses at the proxy) ----

export async function runCopilotTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const access = requireAccessToken(input.credential, "GitHub Copilot");
  const baseUrl = copilotBaseUrl(access, input.credential.enterpriseUrl ?? undefined);
  const body: JsonRecord = {
    model: input.model,
    input: toResponsesInput(input.messages),
    tools: responsesToolDefs(input.tools),
    tool_choice: "auto",
    store: false,
  };
  const response = await postJson(`${baseUrl}/responses`, {
    Authorization: `Bearer ${access}`,
    ...COPILOT_HEADERS,
    "X-Initiator": lastMessageIsUser(input.messages) ? "user" : "agent",
    "Openai-Intent": "conversation-edits",
  }, body);
  const parsed = parseResponsesOutput(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data) };
}

// ---- Custom OpenAI-compatible endpoint (base URL + key) ----

export async function runCustomOpenAiTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  if (!input.credential.baseUrl) throw new Error("Custom OpenAI-compatible provider is missing its base URL.");
  const body: JsonRecord = {
    model: input.model,
    messages: toChatMessages(input.instructions, input.messages),
    tools: chatToolDefs(input.tools),
    tool_choice: "auto",
    stream: false,
  };
  const response = await postJson(`${input.credential.baseUrl}/chat/completions`, { authorization: `Bearer ${requireApiKey(input.credential, "Custom OpenAI-compatible provider")}` }, body);
  const parsed = parseChatChoice(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data) };
}

// ---- Custom Anthropic-compatible endpoint (base URL + key) ----

export async function runCustomAnthropicTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  if (!input.credential.baseUrl) throw new Error("Custom Anthropic-compatible provider is missing its base URL.");
  const body: JsonRecord = {
    model: input.model,
    max_tokens: 4096,
    tools: anthropicToolDefs(input.tools),
    messages: toAnthropicMessages(input.messages),
    ...(input.instructions ? { system: input.instructions } : {}),
  };
  const response = await postJson(`${input.credential.baseUrl}/v1/messages`, { "x-api-key": requireApiKey(input.credential, "Custom Anthropic-compatible provider"), "anthropic-version": "2023-06-01" }, body);
  const parsed = parseAnthropicContent(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data) };
}

// ---- Google Antigravity (OAuth, Gemini Code Assist, SSE) ----

export async function runAntigravityTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const access = requireAccessToken(input.credential, "Google Antigravity");
  if (!input.credential.projectId) throw new Error("Antigravity credential is missing its project id.");
  const requestId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const body = antigravityRequestBody({
    model: input.model,
    projectId: input.credential.projectId,
    instructions: input.instructions,
    messages: input.messages,
    tools: input.tools,
    requestId,
  });
  const response = await postEventStream(`${ANTIGRAVITY_ENDPOINT}/v1internal:streamGenerateContent?alt=sse`, {
    Authorization: `Bearer ${access}`,
    "User-Agent": `antigravity/${ANTIGRAVITY_VERSION} darwin/arm64`,
  }, body);
  return accumulateGeminiStream(response.messages);
}
