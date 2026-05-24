import { PROVIDER_AUTH_TYPE, type ProviderAuthType } from "../../shared/domain";
import { listProviderModels, type ProviderModelEntry } from "../../shared/provider-models";
import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";
import {
  authorizeWithParser,
  refreshUnsupported,
  revokeLocalProfile,
  type ProviderAuthorizeHandler,
  type ProviderRefreshHandler,
  type ProviderRevokeHandler,
} from "./provider-auth-lifecycle";
import { getJson, postEventStream, postJson, type JsonRecord } from "./provider-http";
import {
  cancelUnsupported,
  mapAnthropicMessageStream,
  mapOpenAiChatCompletionStream,
  mapOpenAiResponseStream,
  streamUnsupported,
  type ProviderCancelResult,
  type ProviderStreamResult,
} from "./provider-streaming";

export { ProviderHttpError, providerRateLimitStateFromError } from "./provider-http";

export interface ProviderExecutionInput {
  authProfile: ProviderAuthProfile;
  model: string;
  prompt: string;
  instructions: string | null;
}

export interface ProviderExecutionResult {
  text: string;
  rawResponseJson: string;
  rateLimitState: ProviderObservedRateLimitState | null;
}

export type ProviderStreamInput = ProviderExecutionInput;

export interface ProviderCancelInput {
  authProfile: ProviderAuthProfile;
  responseId: string;
}

export interface ProviderHealthInput {
  authProfile: ProviderAuthProfile;
  model: string | null;
}

export interface ProviderHealthResult {
  checkedAt: string;
  rateLimitState: ProviderObservedRateLimitState | null;
}

export interface ProviderContext {
  authProfile: ProviderAuthProfile;
  model: string | null;
}

export interface ProviderRateLimitState {
  requestLimit: number | null;
  remainingRequests: number | null;
  resetAt: string | null;
  retryAfterMs: number | null;
  rawStateJson: string;
}

export interface ProviderAdapter {
  providerKey: string;
  authType: ProviderAuthType;
  authorize: ProviderAuthorizeHandler;
  refresh: ProviderRefreshHandler;
  revoke: ProviderRevokeHandler;
  parseAuthProfile(secret: string): ProviderAuthProfile;
  listModels(ctx: ProviderContext): Promise<ProviderModelEntry[]>;
  getRateLimitState(ctx: ProviderContext): Promise<ProviderRateLimitState | null>;
  checkHealth(input: ProviderHealthInput): Promise<ProviderHealthResult>;
  streamResponse(input: ProviderStreamInput): Promise<ProviderStreamResult>;
  cancelResponse(input: ProviderCancelInput): Promise<ProviderCancelResult>;
  createResponse?: (input: ProviderExecutionInput) => Promise<ProviderExecutionResult>;
}

export type ProviderAdapterRegistry = Record<string, ProviderAdapter>;

export type ProviderAuthProfile =
  | { type: "api_key"; apiKey: string }
  | { type: "access_token"; accessToken: string }
  | { type: "account_token"; accessToken: string }
  | { type: "azure_openai"; baseUrl: string; deployment: string; apiKey: string }
  | { type: "aws_bedrock"; region: string; accessKeyId: string; secretAccessKey: string; sessionToken: string | null }
  | { type: "vertex_ai"; projectId: string; region: string; serviceAccountJson: string };

export const providerAdapters: ProviderAdapterRegistry = {
  openai: {
    providerKey: "openai",
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    authorize: authorizeWithParser(parseApiKey),
    refresh: refreshUnsupported("OpenAI API key"),
    revoke: revokeLocalProfile((profile) => { requireApiKeyProfile(profile, "OpenAI"); }),
    parseAuthProfile: parseApiKey,
    listModels: () => listStaticModels("openai"),
    getRateLimitState: providerRateLimitUnknown,
    checkHealth: (input) => checkOpenAiHealth(input.authProfile, "https://api.openai.com/v1/models"),
    async streamResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "OpenAI");
      const response = await postEventStream("https://api.openai.com/v1/responses", {
        authorization: `Bearer ${profile.apiKey}`,
      }, {
        model: input.model,
        input: input.prompt,
        stream: true,
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
    async createResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "OpenAI");
      const response = await postJson("https://api.openai.com/v1/responses", {
        authorization: `Bearer ${profile.apiKey}`,
      }, {
        model: input.model,
        input: input.prompt,
        ...(input.instructions ? { instructions: input.instructions } : {}),
      });
      const data = response.data;
      const text = requireText(collectText(data.output_text ?? data.output), "OpenAI");
      return { text, rawResponseJson: JSON.stringify(data), rateLimitState: response.rateLimitState };
    },
  },
  anthropic: {
    providerKey: "anthropic",
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    authorize: authorizeWithParser(parseApiKey),
    refresh: refreshUnsupported("Anthropic API key"),
    revoke: revokeLocalProfile((profile) => { requireApiKeyProfile(profile, "Anthropic"); }),
    parseAuthProfile: parseApiKey,
    listModels: () => listStaticModels("anthropic"),
    getRateLimitState: providerRateLimitUnknown,
    async checkHealth(input) {
      const profile = requireApiKeyProfile(input.authProfile, "Anthropic");
      const response = await getJson("https://api.anthropic.com/v1/models", {
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
      });
      return healthy(response.rateLimitState);
    },
    async streamResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "Anthropic");
      const response = await postEventStream("https://api.anthropic.com/v1/messages", {
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
      }, {
        model: input.model,
        max_tokens: 4096,
        stream: true,
        ...(input.instructions ? { system: input.instructions } : {}),
        messages: [{ role: "user", content: input.prompt }],
      });
      return { events: mapAnthropicMessageStream(response.messages), rateLimitState: response.rateLimitState };
    },
    cancelResponse: cancelUnsupported("Anthropic"),
    async createResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "Anthropic");
      const response = await postJson("https://api.anthropic.com/v1/messages", {
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
      }, {
        model: input.model,
        max_tokens: 4096,
        ...(input.instructions ? { system: input.instructions } : {}),
        messages: [{ role: "user", content: input.prompt }],
      });
      const data = response.data;
      const text = requireText(collectText(data.content), "Anthropic");
      return { text, rawResponseJson: JSON.stringify(data), rateLimitState: response.rateLimitState };
    },
  },
  xai: openAiCompatibleAdapter({
    providerKey: "xai",
    label: "xAI",
    endpoint: "https://api.x.ai/v1/chat/completions",
    healthUrl: "https://api.x.ai/v1/models",
  }),
  groq: openAiCompatibleAdapter({
    providerKey: "groq",
    label: "Groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    healthUrl: "https://api.groq.com/openai/v1/models",
  }),
  "github-copilot": browserTokenAdapter("github-copilot", PROVIDER_AUTH_TYPE.OAUTH_PKCE),
  "google-antigravity": browserTokenAdapter("google-antigravity", PROVIDER_AUTH_TYPE.OAUTH_PKCE),
  "gpt-account": browserTokenAdapter("gpt-account", PROVIDER_AUTH_TYPE.ACCOUNT_SUBSCRIPTION),
  "azure-openai": {
    providerKey: "azure-openai",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    authorize: authorizeWithParser(parseAzureProfile),
    refresh: refreshUnsupported("Azure OpenAI cloud credential"),
    revoke: revokeLocalProfile((profile) => { requireAzureProfile(profile); }),
    parseAuthProfile: parseAzureProfile,
    listModels: () => listStaticModels("azure-openai"),
    getRateLimitState: providerRateLimitUnknown,
    streamResponse: streamUnsupported("Azure OpenAI"),
    cancelResponse: cancelUnsupported("Azure OpenAI"),
    async checkHealth(input) {
      const profile = requireAzureProfile(input.authProfile);
      const response = await getJson(`${profile.baseUrl}/openai/deployments?api-version=2024-10-21`, { "api-key": profile.apiKey });
      return healthy(response.rateLimitState);
    },
  },
  "aws-bedrock": {
    providerKey: "aws-bedrock",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    authorize: authorizeWithParser(parseBedrockProfile),
    refresh: refreshUnsupported("AWS Bedrock cloud credential"),
    revoke: revokeLocalProfile((profile) => { requireBedrockProfile(profile); }),
    parseAuthProfile: parseBedrockProfile,
    listModels: () => listStaticModels("aws-bedrock"),
    getRateLimitState: providerRateLimitUnknown,
    streamResponse: streamUnsupported("AWS Bedrock"),
    cancelResponse: cancelUnsupported("AWS Bedrock"),
    checkHealth: async (input) => {
      requireBedrockProfile(input.authProfile);
      return healthy(null);
    },
  },
  "vertex-ai": {
    providerKey: "vertex-ai",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    authorize: authorizeWithParser(parseVertexProfile),
    refresh: refreshUnsupported("Vertex AI cloud credential"),
    revoke: revokeLocalProfile((profile) => { requireVertexProfile(profile); }),
    parseAuthProfile: parseVertexProfile,
    listModels: () => listStaticModels("vertex-ai"),
    getRateLimitState: providerRateLimitUnknown,
    streamResponse: streamUnsupported("Vertex AI"),
    cancelResponse: cancelUnsupported("Vertex AI"),
    checkHealth: async (input) => {
      requireVertexProfile(input.authProfile);
      return healthy(null);
    },
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

function openAiCompatibleAdapter({
  providerKey,
  label,
  endpoint,
  healthUrl,
}: {
  providerKey: string;
  label: string;
  endpoint: string;
  healthUrl: string;
}): ProviderAdapter {
  return {
    providerKey,
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    authorize: authorizeWithParser(parseApiKey),
    refresh: refreshUnsupported(`${label} API key`),
    revoke: revokeLocalProfile((profile) => { requireApiKeyProfile(profile, label); }),
    parseAuthProfile: parseApiKey,
    listModels: () => listStaticModels(providerKey),
    getRateLimitState: providerRateLimitUnknown,
    checkHealth: (input) => checkOpenAiHealth(input.authProfile, healthUrl),
    async streamResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, label);
      const messages = responseMessages(input.instructions, input.prompt);
      const response = await postEventStream(endpoint, {
        authorization: `Bearer ${profile.apiKey}`,
      }, {
        model: input.model,
        messages,
        stream: true,
      });
      return { events: mapOpenAiChatCompletionStream(response.messages), rateLimitState: response.rateLimitState };
    },
    cancelResponse: cancelUnsupported(label),
    async createResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, label);
      const messages = responseMessages(input.instructions, input.prompt);
      const response = await postJson(endpoint, {
        authorization: `Bearer ${profile.apiKey}`,
      }, {
        model: input.model,
        messages,
      });
      const data = response.data;
      const text = requireText(collectText(data.choices), label);
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

async function checkOpenAiHealth(authProfile: ProviderAuthProfile, healthUrl: string): Promise<ProviderHealthResult> {
  const profile = requireApiKeyProfile(authProfile, "OpenAI-compatible provider");
  const response = await getJson(healthUrl, { authorization: `Bearer ${profile.apiKey}` });
  return healthy(response.rateLimitState);
}

function browserTokenAdapter(providerKey: string, authType: ProviderAuthType): ProviderAdapter {
  const parseAuthProfile = authType === PROVIDER_AUTH_TYPE.ACCOUNT_SUBSCRIPTION ? parseAccountToken : parseAccessToken;
  const assertProfile = authType === PROVIDER_AUTH_TYPE.ACCOUNT_SUBSCRIPTION ? requireAccountTokenProfile : requireAccessTokenProfile;
  return {
    providerKey,
    authType,
    authorize: authorizeWithParser(parseAuthProfile),
    refresh: refreshUnsupported(`${providerKey} token`),
    revoke: revokeLocalProfile((profile) => { assertProfile(profile); }),
    parseAuthProfile,
    listModels: () => listStaticModels(providerKey),
    getRateLimitState: providerRateLimitUnknown,
    streamResponse: streamUnsupported(providerKey),
    cancelResponse: cancelUnsupported(providerKey),
    checkHealth: async (input) => {
      if (authType === PROVIDER_AUTH_TYPE.ACCOUNT_SUBSCRIPTION) requireAccountTokenProfile(input.authProfile);
      else requireAccessTokenProfile(input.authProfile);
      return healthy(null);
    },
  };
}

function parseApiKey(secret: string): ProviderAuthProfile {
  return { type: "api_key", apiKey: nonEmptySecret(secret, "API key") };
}

function parseAccessToken(secret: string): ProviderAuthProfile {
  return { type: "access_token", accessToken: nonEmptySecret(secret, "Access token") };
}

function parseAccountToken(secret: string): ProviderAuthProfile {
  return { type: "account_token", accessToken: nonEmptySecret(secret, "Account token") };
}

function parseAzureProfile(secret: string): ProviderAuthProfile {
  const parsed = parseCloudSecret(secret);
  const baseUrl = requiredString(parsed.baseUrl, "Azure base URL").replace(/\/+$/, "");
  const deployment = requiredString(parsed.deployment, "Azure deployment");
  return { type: "azure_openai", baseUrl: normalizedHttpsUrl(baseUrl, "Azure base URL"), deployment, apiKey: requiredString(parsed.secret, "Azure API key") };
}

function parseBedrockProfile(secret: string): ProviderAuthProfile {
  const parsed = parseCloudSecret(secret);
  const credential = parseCredentialJson(requiredString(parsed.secret, "AWS credential"));
  return {
    type: "aws_bedrock",
    region: requiredString(parsed.region, "AWS region"),
    accessKeyId: requiredString(credential.accessKeyId, "AWS access key id"),
    secretAccessKey: requiredString(credential.secretAccessKey, "AWS secret access key"),
    sessionToken: typeof credential.sessionToken === "string" && credential.sessionToken.trim() ? credential.sessionToken.trim() : null,
  };
}

function parseVertexProfile(secret: string): ProviderAuthProfile {
  const parsed = parseCloudSecret(secret);
  const serviceAccountJson = requiredString(parsed.secret, "Vertex service account JSON");
  parseCredentialJson(serviceAccountJson);
  return {
    type: "vertex_ai",
    projectId: requiredString(parsed.projectId, "Vertex project id"),
    region: requiredString(parsed.region, "Vertex region"),
    serviceAccountJson,
  };
}

function parseCloudSecret(secret: string): JsonRecord {
  try {
    const parsed = JSON.parse(secret) as unknown;
    if (!isRecord(parsed)) throw new Error("Cloud credential profile is invalid.");
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Cloud credential profile must be JSON.");
    throw error;
  }
}

function parseCredentialJson(value: string): JsonRecord {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) throw new Error("Credential JSON is invalid.");
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Credential must be JSON.");
    throw error;
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function nonEmptySecret(secret: string, label: string): string {
  const value = secret.trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function normalizedHttpsUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  return url.toString().replace(/\/+$/, "");
}

function requireApiKeyProfile(profile: ProviderAuthProfile, label: string): Extract<ProviderAuthProfile, { type: "api_key" }> {
  if (profile.type !== "api_key") throw new Error(`${label} API key profile is required.`);
  return profile;
}

function requireAccessTokenProfile(profile: ProviderAuthProfile): Extract<ProviderAuthProfile, { type: "access_token" }> {
  if (profile.type !== "access_token") throw new Error("Access token profile is required.");
  return profile;
}

function requireAccountTokenProfile(profile: ProviderAuthProfile): Extract<ProviderAuthProfile, { type: "account_token" }> {
  if (profile.type !== "account_token") throw new Error("Account token profile is required.");
  return profile;
}

function requireAzureProfile(profile: ProviderAuthProfile): Extract<ProviderAuthProfile, { type: "azure_openai" }> {
  if (profile.type !== "azure_openai") throw new Error("Azure OpenAI profile is required.");
  return profile;
}

function requireBedrockProfile(profile: ProviderAuthProfile): Extract<ProviderAuthProfile, { type: "aws_bedrock" }> {
  if (profile.type !== "aws_bedrock") throw new Error("AWS Bedrock profile is required.");
  return profile;
}

function requireVertexProfile(profile: ProviderAuthProfile): Extract<ProviderAuthProfile, { type: "vertex_ai" }> {
  if (profile.type !== "vertex_ai") throw new Error("Vertex AI profile is required.");
  return profile;
}

function requireResponseId(value: string): string {
  const responseId = value.trim();
  if (!responseId) throw new Error("Provider response id is required.");
  return responseId;
}

function healthy(rateLimitState: ProviderObservedRateLimitState | null): ProviderHealthResult {
  return { checkedAt: new Date().toISOString(), rateLimitState };
}

function listStaticModels(providerKey: string): Promise<ProviderModelEntry[]> {
  return Promise.resolve(listProviderModels(providerKey));
}

async function providerRateLimitUnknown(): Promise<ProviderRateLimitState | null> {
  return null;
}
