import { PROVIDER_AUTH_TYPE, type ProviderAuthType } from "../../shared/domain";
import { listProviderModels, type ProviderModelEntry } from "../../shared/provider-models";
import {
  oauthProfileParser,
  parseApiKey,
  parseAnthropicCompatProfile,
  parseAzureProfile,
  parseBedrockProfile,
  parseOpenAiCompatProfile,
  parseVertexProfile,
  requireAccessTokenProfile,
  requireApiKeyProfile,
} from "./provider-auth-profiles";
import { backgroundUnsupported, retrieveUnsupported } from "./provider-background";
import { authorizeWithParser, refreshUnsupported } from "./provider-auth-lifecycle";
import { getJson, postEventStream, postJson, WHOLE_RESPONSE_WAIT, type JsonRecord } from "./provider-http";
import { OUTPUT_RESERVE_TOKENS } from "./context-budget";
import { chatMaxTokensField } from "./provider-tool-turns/chat-format";
import { fetchAnthropicModels, fetchOpenAiModels } from "./provider-models-fetch";
import { KIMI_CODE_BASE_URL } from "./oauth/kimi-code-flow";
import { FINISHED_STOP_REASONS, incompleteTurn, requireFinished } from "./provider-tool-turn";
import { incompleteReason } from "./provider-tool-turns/responses-format";

const ANTHROPIC_VERSION = "2023-06-01";
const CLAUDE_PRO_BETA = "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14";
import {
  cancelUnsupported,
  mapAnthropicMessageStream,
  mapOpenAiChatCompletionStream,
  mapOpenAiResponseStream,
  streamUnsupported,
} from "./provider-streaming";

export { ProviderHttpError, providerRateLimitStateFromError } from "./provider-http";
export type { ProviderAuthProfile } from "./provider-auth-profiles";
export * from "./provider-adapter-contract";

import type {
  ProviderAdapter,
  ProviderAdapterRegistry,
  ProviderRateLimitState,
} from "./provider-adapter-contract";

export const providerAdapters: ProviderAdapterRegistry = {
  openai: {
    providerKey: "openai",
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    authorize: authorizeWithParser(parseApiKey),
    refresh: refreshUnsupported("OpenAI API key"),
    parseAuthProfile: parseApiKey,
    listModels: (ctx) => fetchOpenAiModels("https://api.openai.com/v1/models", {
      authorization: `Bearer ${requireApiKeyProfile(ctx.authProfile, "OpenAI").apiKey}`,
    }),
    getRateLimitState: providerRateLimitUnknown,
    async streamResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "OpenAI");
      const response = await postEventStream("https://api.openai.com/v1/responses", {
        authorization: `Bearer ${profile.apiKey}`,
      }, {
        model: input.model,
        input: input.prompt,
        stream: true,
        max_output_tokens: OUTPUT_RESERVE_TOKENS,
        ...(input.instructions ? { instructions: input.instructions } : {}),
      });
      return { events: mapOpenAiResponseStream(response.messages), rateLimitState: response.rateLimitState };
    },
    async cancelResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "OpenAI");
      const responseId = requireResponseId(input.responseId);
      const response = await postJson(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}/cancel`, {
        authorization: `Bearer ${profile.apiKey}`,
      }, {});
      return { responseId, rawResponseJson: JSON.stringify(response.data), rateLimitState: response.rateLimitState };
    },
    async createBackgroundResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "OpenAI");
      const response = await postJson("https://api.openai.com/v1/responses", {
        authorization: `Bearer ${profile.apiKey}`,
      }, {
        model: input.model,
        input: input.prompt,
        background: true,
        store: true,
        max_output_tokens: OUTPUT_RESERVE_TOKENS,
        ...(input.instructions ? { instructions: input.instructions } : {}),
      });
      const data = response.data;
      return {
        responseId: requireStringField(data, "id", "OpenAI response id"),
        status: requireStringField(data, "status", "OpenAI response status"),
        rawResponseJson: JSON.stringify(data),
        rateLimitState: response.rateLimitState,
      };
    },
    async retrieveResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "OpenAI");
      const responseId = requireResponseId(input.responseId);
      const response = await getJson(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
        authorization: `Bearer ${profile.apiKey}`,
      });
      const data = response.data;
      return {
        responseId: requireStringField(data, "id", "OpenAI response id"),
        status: requireStringField(data, "status", "OpenAI response status"),
        text: optionalText(collectText(data.output_text ?? data.output)),
        rawResponseJson: JSON.stringify(data),
        rateLimitState: response.rateLimitState,
      };
    },
    async createResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "OpenAI");
      const response = await postJson("https://api.openai.com/v1/responses", {
        authorization: `Bearer ${profile.apiKey}`,
      }, {
        model: input.model,
        input: input.prompt,
        max_output_tokens: OUTPUT_RESERVE_TOKENS,
        ...(input.instructions ? { instructions: input.instructions } : {}),
      }, WHOLE_RESPONSE_WAIT);
      const data = response.data;
      if (data.status !== "completed") throw incompleteTurn(incompleteReason(data));
      const text = requireText(collectText(data.output_text ?? data.output), "OpenAI");
      return { text, rawResponseJson: JSON.stringify(data), rateLimitState: response.rateLimitState };
    },
  },
  anthropic: {
    providerKey: "anthropic",
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    authorize: authorizeWithParser(parseApiKey),
    refresh: refreshUnsupported("Anthropic API key"),
    parseAuthProfile: parseApiKey,
    listModels: (ctx) => fetchAnthropicModels("https://api.anthropic.com/v1/models", {
      "x-api-key": requireApiKeyProfile(ctx.authProfile, "Anthropic").apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    }),
    getRateLimitState: providerRateLimitUnknown,
    async streamResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "Anthropic");
      const response = await postEventStream("https://api.anthropic.com/v1/messages", {
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
      }, {
        model: input.model,
        max_tokens: OUTPUT_RESERVE_TOKENS,
        stream: true,
        ...(input.instructions ? { system: input.instructions } : {}),
        messages: [{ role: "user", content: input.prompt }],
      });
      return { events: mapAnthropicMessageStream(response.messages), rateLimitState: response.rateLimitState };
    },
    cancelResponse: cancelUnsupported("Anthropic"),
    createBackgroundResponse: backgroundUnsupported("Anthropic"),
    retrieveResponse: retrieveUnsupported("Anthropic"),
    async createResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "Anthropic");
      const response = await postJson("https://api.anthropic.com/v1/messages", {
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
      }, {
        model: input.model,
        max_tokens: OUTPUT_RESERVE_TOKENS,
        ...(input.instructions ? { system: input.instructions } : {}),
        messages: [{ role: "user", content: input.prompt }],
      }, WHOLE_RESPONSE_WAIT);
      const data = response.data;
      requireFinished(data.stop_reason, FINISHED_STOP_REASONS.anthropic);
      const text = requireText(collectText(data.content), "Anthropic");
      return { text, rawResponseJson: JSON.stringify(data), rateLimitState: response.rateLimitState };
    },
  },
  xai: openAiCompatibleAdapter({
    providerKey: "xai",
    label: "xAI",
    endpoint: "https://api.x.ai/v1/chat/completions",
    healthUrl: "https://api.x.ai/v1/models",
    requestStreamUsage: true,
  }),
  groq: openAiCompatibleAdapter({
    providerKey: "groq",
    label: "Groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    healthUrl: "https://api.groq.com/openai/v1/models",
    requestStreamUsage: true,
  }),
  mistral: openAiCompatibleAdapter({
    providerKey: "mistral",
    label: "Mistral",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    healthUrl: "https://api.mistral.ai/v1/models",
  }),
  cerebras: openAiCompatibleAdapter({
    providerKey: "cerebras",
    label: "Cerebras",
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
    healthUrl: "https://api.cerebras.ai/v1/models",
  }),
  openrouter: openAiCompatibleAdapter({
    providerKey: "openrouter",
    label: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    healthUrl: "https://openrouter.ai/api/v1/models",
  }),
  kimi: openAiCompatibleAdapter({
    providerKey: "kimi",
    label: "Kimi",
    endpoint: "https://api.moonshot.ai/v1/chat/completions",
    healthUrl: "https://api.moonshot.ai/v1/models",
  }),
  "kimi-cn": openAiCompatibleAdapter({
    providerKey: "kimi-cn",
    label: "Kimi CN",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    healthUrl: "https://api.moonshot.cn/v1/models",
  }),
  "github-copilot": browserTokenAdapter("github-copilot", PROVIDER_AUTH_TYPE.OAUTH_PKCE),
  "gpt-account": browserTokenAdapter("gpt-account", PROVIDER_AUTH_TYPE.ACCOUNT_SUBSCRIPTION),
  "claude-pro": {
    ...browserTokenAdapter("claude-pro", PROVIDER_AUTH_TYPE.OAUTH_PKCE),
    listModels: (ctx) => fetchAnthropicModels("https://api.anthropic.com/v1/models", {
      authorization: `Bearer ${requireAccessTokenProfile(ctx.authProfile).accessToken}`,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": CLAUDE_PRO_BETA,
    }),
  },
  "kimi-code": {
    ...browserTokenAdapter("kimi-code", PROVIDER_AUTH_TYPE.OAUTH_PKCE),
    listModels: (ctx) => fetchOpenAiModels(`${KIMI_CODE_BASE_URL}/models`, {
      authorization: `Bearer ${requireAccessTokenProfile(ctx.authProfile).accessToken}`,
    }),
  },
  "azure-openai": {
    providerKey: "azure-openai",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    authorize: authorizeWithParser(parseAzureProfile),
    refresh: refreshUnsupported("Azure OpenAI cloud credential"),
    parseAuthProfile: parseAzureProfile,
    listModels: () => listStaticModels("azure-openai"),
    getRateLimitState: providerRateLimitUnknown,
    streamResponse: streamUnsupported("Azure OpenAI"),
    cancelResponse: cancelUnsupported("Azure OpenAI"),
    createBackgroundResponse: backgroundUnsupported("Azure OpenAI"),
    retrieveResponse: retrieveUnsupported("Azure OpenAI"),
  },
  "aws-bedrock": {
    providerKey: "aws-bedrock",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    authorize: authorizeWithParser(parseBedrockProfile),
    refresh: refreshUnsupported("AWS Bedrock cloud credential"),
    parseAuthProfile: parseBedrockProfile,
    listModels: () => listStaticModels("aws-bedrock"),
    getRateLimitState: providerRateLimitUnknown,
    streamResponse: streamUnsupported("AWS Bedrock"),
    cancelResponse: cancelUnsupported("AWS Bedrock"),
    createBackgroundResponse: backgroundUnsupported("AWS Bedrock"),
    retrieveResponse: retrieveUnsupported("AWS Bedrock"),
  },
  "vertex-ai": {
    providerKey: "vertex-ai",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    authorize: authorizeWithParser(parseVertexProfile),
    refresh: refreshUnsupported("Vertex AI cloud credential"),
    parseAuthProfile: parseVertexProfile,
    listModels: () => listStaticModels("vertex-ai"),
    getRateLimitState: providerRateLimitUnknown,
    streamResponse: streamUnsupported("Vertex AI"),
    cancelResponse: cancelUnsupported("Vertex AI"),
    createBackgroundResponse: backgroundUnsupported("Vertex AI"),
    retrieveResponse: retrieveUnsupported("Vertex AI"),
  },
  "custom-openai": {
    providerKey: "custom-openai",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    authorize: authorizeWithParser(parseOpenAiCompatProfile),
    refresh: refreshUnsupported("Custom OpenAI-compatible endpoint"),
    parseAuthProfile: parseOpenAiCompatProfile,
    listModels: () => listStaticModels("custom-openai"),
    getRateLimitState: providerRateLimitUnknown,
    streamResponse: streamUnsupported("Custom OpenAI-compatible endpoint"),
    cancelResponse: cancelUnsupported("Custom OpenAI-compatible endpoint"),
    createBackgroundResponse: backgroundUnsupported("Custom OpenAI-compatible endpoint"),
    retrieveResponse: retrieveUnsupported("Custom OpenAI-compatible endpoint"),
  },
  "custom-anthropic": {
    providerKey: "custom-anthropic",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    authorize: authorizeWithParser(parseAnthropicCompatProfile),
    refresh: refreshUnsupported("Custom Anthropic-compatible endpoint"),
    parseAuthProfile: parseAnthropicCompatProfile,
    listModels: () => listStaticModels("custom-anthropic"),
    getRateLimitState: providerRateLimitUnknown,
    streamResponse: streamUnsupported("Custom Anthropic-compatible endpoint"),
    cancelResponse: cancelUnsupported("Custom Anthropic-compatible endpoint"),
    createBackgroundResponse: backgroundUnsupported("Custom Anthropic-compatible endpoint"),
    retrieveResponse: retrieveUnsupported("Custom Anthropic-compatible endpoint"),
  },
};

function collectText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectText(item));
  if (!isRecord(value)) return [];
  const direct = ["text", "output_text", "content"].flatMap((key) => collectText(value[key]));
  return direct.length > 0 ? direct : Object.values(value).flatMap((item) => collectText(item));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(parts: string[], providerKey: string): string {
  const text = parts.map((part) => part.trim()).filter(Boolean).join("\n");
  if (!text) throw new Error(`${providerKey} returned no text content.`);
  return text;
}

function optionalText(parts: string[]): string | null {
  const text = parts.map((part) => part.trim()).filter(Boolean).join("\n");
  return text || null;
}

function requireStringField(record: JsonRecord, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function openAiCompatibleAdapter({
  providerKey,
  label,
  endpoint,
  healthUrl,
  requestStreamUsage = false,
}: {
  providerKey: string;
  label: string;
  endpoint: string;
  healthUrl: string;
  /** Providers that report a stream's token usage only when asked (xAI, Groq). */
  requestStreamUsage?: boolean;
}): ProviderAdapter {
  return {
    providerKey,
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    authorize: authorizeWithParser(parseApiKey),
    refresh: refreshUnsupported(`${label} API key`),
    parseAuthProfile: parseApiKey,
    listModels: (ctx) => fetchOpenAiModels(healthUrl, {
      authorization: `Bearer ${requireApiKeyProfile(ctx.authProfile, label).apiKey}`,
    }),
    getRateLimitState: providerRateLimitUnknown,
    async streamResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, label);
      const messages = responseMessages(input.instructions, input.prompt);
      const response = await postEventStream(endpoint, {
        authorization: `Bearer ${profile.apiKey}`,
      }, {
        model: input.model,
        messages,
        stream: true,
        [chatMaxTokensField(providerKey)]: OUTPUT_RESERVE_TOKENS,
        ...(requestStreamUsage ? { stream_options: { include_usage: true } } : {}),
      });
      return { events: mapOpenAiChatCompletionStream(response.messages), rateLimitState: response.rateLimitState };
    },
    cancelResponse: cancelUnsupported(label),
    createBackgroundResponse: backgroundUnsupported(label),
    retrieveResponse: retrieveUnsupported(label),
    async createResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, label);
      const messages = responseMessages(input.instructions, input.prompt);
      const response = await postJson(endpoint, {
        authorization: `Bearer ${profile.apiKey}`,
      }, {
        model: input.model,
        messages,
        [chatMaxTokensField(providerKey)]: OUTPUT_RESERVE_TOKENS,
      }, WHOLE_RESPONSE_WAIT);
      const data = response.data;
      requireFinished(Array.isArray(data.choices) && isRecord(data.choices[0]) ? data.choices[0].finish_reason : null, FINISHED_STOP_REASONS.chat);
      const text = requireText(collectText(Array.isArray(data.choices) ? data.choices.filter(isRecord).map((choice) => choice.message) : []), label);
      return { text, rawResponseJson: JSON.stringify(data), rateLimitState: response.rateLimitState };
    },
  };
}

function responseMessages(instructions: string | null, prompt: string): Array<{ role: "system" | "user"; content: string }> {
  return [
    ...(instructions ? [{ role: "system" as const, content: instructions }] : []),
    { role: "user", content: prompt },
  ];
}

function browserTokenAdapter(providerKey: string, authType: ProviderAuthType): ProviderAdapter {
  const parseAuthProfile = oauthProfileParser(providerKey, authType === PROVIDER_AUTH_TYPE.ACCOUNT_SUBSCRIPTION ? "account_token" : "access_token");
  return {
    providerKey,
    authType,
    authorize: authorizeWithParser(parseAuthProfile),
    refresh: refreshUnsupported(`${providerKey} token`),
    parseAuthProfile,
    listModels: () => listStaticModels(providerKey),
    getRateLimitState: providerRateLimitUnknown,
    streamResponse: streamUnsupported(providerKey),
    cancelResponse: cancelUnsupported(providerKey),
    createBackgroundResponse: backgroundUnsupported(providerKey),
    retrieveResponse: retrieveUnsupported(providerKey),
  };
}

function requireResponseId(value: string): string {
  const responseId = value.trim();
  if (!responseId) throw new Error("Provider response id is required.");
  return responseId;
}

function listStaticModels(providerKey: string): Promise<ProviderModelEntry[]> {
  return Promise.resolve(listProviderModels(providerKey));
}

async function providerRateLimitUnknown(): Promise<ProviderRateLimitState | null> {
  return null;
}
