/**
 * Per-backend tool-use turn functions. Each takes the normalized
 * {@link ProviderToolTurnInput} (with a resolved credential) and returns an
 * {@link AgentTurnResult}. Faithful ports of Pi's provider request handlers.
 */
import { release as osRelease, arch as osArch, platform as osPlatform } from "node:os";
import { postEventStream, postJson, WHOLE_RESPONSE_WAIT, type JsonRecord } from "../provider-http";
import type { AgentTurnMessage, AgentTurnResult, ProviderToolTurnInput, TurnCredential } from "../provider-tool-turn";
import { accumulateResponsesStream, parseResponsesOutput, responsesToolDefs, toResponsesInput } from "./responses-format";
import { anthropicToolDefs, parseAnthropicContent, toAnthropicMessages } from "./anthropic-format";
import { accumulateChatStream, chatMaxTokensField, chatToolDefs, parseChatChoice, toChatMessages } from "./chat-format";
import { accumulateGeminiStream, antigravityRequestBody, parseGeminiResponse, vertexRequestBody } from "./gemini-format";
import { bedrockToolConfig, parseBedrockOutput, toBedrockMessages } from "./bedrock-format";
import { signAwsRequest } from "./aws-sigv4";
import { getGcpAccessToken } from "./gcp-auth";
import { COPILOT_HEADERS, copilotBaseUrl } from "../oauth/github-copilot-flow";
import { KIMI_CODE_BASE_URL } from "../oauth/kimi-code-flow";
import { OUTPUT_RESERVE_TOKENS } from "../context-budget";

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
    max_output_tokens: OUTPUT_RESERVE_TOKENS,
    ...(input.instructions ? { instructions: input.instructions } : {}),
  };
  const response = await postJson("https://api.openai.com/v1/responses", { authorization: `Bearer ${requireApiKey(input.credential, "OpenAI")}` }, body, WHOLE_RESPONSE_WAIT);
  const parsed = parseResponsesOutput(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data), rateLimitState: response.rateLimitState };
}

// ---- OpenAI Chat Completions, streamed (xAI, Groq, Mistral, Cerebras, OpenRouter, Kimi, Kimi CN) ----

/** Streamed so a long think never meets a header deadline; only a stream that goes idle times out. */
async function runChatCompletionsStream(providerKey: string, endpoint: string, headers: Record<string, string>, input: ProviderToolTurnInput, requestUsage = false): Promise<AgentTurnResult> {
  const body: JsonRecord = {
    model: input.model,
    messages: toChatMessages(input.instructions, input.messages),
    tools: chatToolDefs(input.tools),
    tool_choice: "auto",
    stream: true,
    [chatMaxTokensField(providerKey)]: OUTPUT_RESERVE_TOKENS,
    // Some providers only report a stream's token usage when asked; the others send it unasked and may reject the field.
    ...(requestUsage ? { stream_options: { include_usage: true } } : {}),
  };
  const response = await postEventStream(endpoint, headers, body);
  return { ...(await accumulateChatStream(response.messages)), rateLimitState: response.rateLimitState };
}

export function makeChatCompletionsTurn(providerKey: string, endpoint: string, label: string, requestUsage = false): (input: ProviderToolTurnInput) => Promise<AgentTurnResult> {
  return async (input) => runChatCompletionsStream(providerKey, endpoint, { authorization: `Bearer ${requireApiKey(input.credential, label)}` }, input, requestUsage);
}

// ---- Anthropic Messages (api key) ----

export async function runAnthropicTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const body: JsonRecord = {
    model: input.model,
    max_tokens: OUTPUT_RESERVE_TOKENS,
    tools: anthropicToolDefs(input.tools),
    messages: toAnthropicMessages(input.messages),
    ...(input.instructions ? { system: input.instructions } : {}),
  };
  const response = await postJson("https://api.anthropic.com/v1/messages", { "x-api-key": requireApiKey(input.credential, "Anthropic"), "anthropic-version": "2023-06-01" }, body, WHOLE_RESPONSE_WAIT);
  const parsed = parseAnthropicContent(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data), rateLimitState: response.rateLimitState };
}

// ---- Claude Pro/Max (OAuth subscription) ----

export async function runClaudeProTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const system: unknown[] = [
    { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
    ...(input.instructions ? [{ type: "text", text: input.instructions }] : []),
  ];
  const body: JsonRecord = {
    model: input.model,
    max_tokens: OUTPUT_RESERVE_TOKENS,
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
  }, body, WHOLE_RESPONSE_WAIT);
  const parsed = parseAnthropicContent(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data), rateLimitState: response.rateLimitState };
}

// ---- Kimi Code (OAuth plan, streamed chat completions at the coding endpoint) ----

export async function runKimiCodeTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const access = requireAccessToken(input.credential, "Kimi Code");
  return runChatCompletionsStream("kimi-code", `${KIMI_CODE_BASE_URL}/chat/completions`, { authorization: `Bearer ${access}` }, input);
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
    // No output cap: the ChatGPT backend takes none, and neither Codex CLI nor Pi sends one.
  };
  const response = await postEventStream(`${CODEX_BASE_URL}/codex/responses`, {
    Authorization: `Bearer ${access}`,
    "chatgpt-account-id": input.credential.accountId,
    originator: "agentcompany",
    "User-Agent": `agentcompany (${osPlatform()} ${osRelease()}; ${osArch()})`,
    "OpenAI-Beta": "responses=experimental",
  }, body);
  return { ...(await accumulateResponsesStream(response.messages)), rateLimitState: response.rateLimitState };
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
    max_output_tokens: OUTPUT_RESERVE_TOKENS,
    ...(input.instructions ? { instructions: input.instructions } : {}),
  };
  const response = await postJson(`${baseUrl}/responses`, {
    Authorization: `Bearer ${access}`,
    ...COPILOT_HEADERS,
    "X-Initiator": lastMessageIsUser(input.messages) ? "user" : "agent",
    "Openai-Intent": "conversation-edits",
  }, body, WHOLE_RESPONSE_WAIT);
  const parsed = parseResponsesOutput(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data), rateLimitState: response.rateLimitState };
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
    // No output cap: whatever serves a custom endpoint decides which cap field, if any, it accepts.
  };
  const response = await postJson(`${input.credential.baseUrl}/chat/completions`, { authorization: `Bearer ${requireApiKey(input.credential, "Custom OpenAI-compatible provider")}` }, body, WHOLE_RESPONSE_WAIT);
  const parsed = parseChatChoice(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data), rateLimitState: response.rateLimitState };
}

// ---- Custom Anthropic-compatible endpoint (base URL + key) ----

export async function runCustomAnthropicTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  if (!input.credential.baseUrl) throw new Error("Custom Anthropic-compatible provider is missing its base URL.");
  const body: JsonRecord = {
    model: input.model,
    max_tokens: OUTPUT_RESERVE_TOKENS,
    tools: anthropicToolDefs(input.tools),
    messages: toAnthropicMessages(input.messages),
    ...(input.instructions ? { system: input.instructions } : {}),
  };
  const response = await postJson(`${input.credential.baseUrl}/v1/messages`, { "x-api-key": requireApiKey(input.credential, "Custom Anthropic-compatible provider"), "anthropic-version": "2023-06-01" }, body, WHOLE_RESPONSE_WAIT);
  const parsed = parseAnthropicContent(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data), rateLimitState: response.rateLimitState };
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
  return { ...(await accumulateGeminiStream(response.messages)), rateLimitState: response.rateLimitState };
}

// ---- Azure OpenAI (Chat Completions at the resource deployment) ----

export async function runAzureTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const apiKey = requireApiKey(input.credential, "Azure OpenAI");
  if (!input.credential.baseUrl) throw new Error("Azure OpenAI credential is missing its base URL.");
  if (!input.credential.deployment) throw new Error("Azure OpenAI credential is missing its deployment name.");
  const body: JsonRecord = {
    model: input.credential.deployment,
    messages: toChatMessages(input.instructions, input.messages),
    tools: chatToolDefs(input.tools),
    tool_choice: "auto",
    stream: false,
    [chatMaxTokensField("azure-openai")]: OUTPUT_RESERVE_TOKENS,
  };
  const url = `${input.credential.baseUrl}/openai/deployments/${input.credential.deployment}/chat/completions?api-version=2024-10-21`;
  const response = await postJson(url, { "api-key": apiKey }, body, WHOLE_RESPONSE_WAIT);
  const parsed = parseChatChoice(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data), rateLimitState: response.rateLimitState };
}

// ---- AWS Bedrock (Converse API, SigV4) ----

export async function runBedrockTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const { region, accessKeyId, secretAccessKey, sessionToken } = input.credential;
  if (!region || !accessKeyId || !secretAccessKey) throw new Error("AWS Bedrock credential is incomplete.");
  const converse: JsonRecord = {
    messages: toBedrockMessages(input.messages),
    // Output limits differ per Bedrock model family; only Claude's are known to cover the reserve, as in Pi.
    ...(input.model.includes("anthropic.") ? { inferenceConfig: { maxTokens: OUTPUT_RESERVE_TOKENS } } : {}),
    toolConfig: bedrockToolConfig(input.tools),
    ...(input.instructions ? { system: [{ text: input.instructions }] } : {}),
  };
  const bodyString = JSON.stringify(converse);
  const signed = signAwsRequest({
    method: "POST",
    host: `bedrock-runtime.${region}.amazonaws.com`,
    rawPath: `/model/${input.model}/converse`,
    body: bodyString,
    signer: { region, service: "bedrock", accessKeyId, secretAccessKey, sessionToken },
  });
  const response = await postJson(signed.url, signed.headers, converse, WHOLE_RESPONSE_WAIT);
  const parsed = parseBedrockOutput(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data), rateLimitState: response.rateLimitState };
}

// ---- Google Vertex AI (Gemini generateContent, service-account auth) ----

export async function runVertexTurn(input: ProviderToolTurnInput): Promise<AgentTurnResult> {
  const { projectId, region, serviceAccountJson } = input.credential;
  if (!projectId || !region || !serviceAccountJson) throw new Error("Vertex AI credential is incomplete.");
  const token = await getGcpAccessToken(serviceAccountJson);
  const body = vertexRequestBody({ model: input.model, instructions: input.instructions, messages: input.messages, tools: input.tools });
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${input.model}:generateContent`;
  const response = await postJson(url, { authorization: `Bearer ${token}` }, body, WHOLE_RESPONSE_WAIT);
  const parsed = parseGeminiResponse(response.data);
  return { ...parsed, rawResponseJson: JSON.stringify(response.data), rateLimitState: response.rateLimitState };
}
