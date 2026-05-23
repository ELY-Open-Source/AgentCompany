import { PROVIDER_AUTH_TYPE, type ProviderAuthType } from "../../shared/domain";

export interface ProviderExecutionInput {
  authProfile: ProviderAuthProfile;
  model: string;
  prompt: string;
  instructions: string | null;
}

export interface ProviderExecutionResult {
  text: string;
  rawResponseJson: string;
}

export interface ProviderHealthInput {
  authProfile: ProviderAuthProfile;
  model: string | null;
}

export interface ProviderHealthResult {
  checkedAt: string;
}

export interface ProviderAdapter {
  providerKey: string;
  authType: ProviderAuthType;
  parseAuthProfile(secret: string): ProviderAuthProfile;
  checkHealth(input: ProviderHealthInput): Promise<ProviderHealthResult>;
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

type JsonRecord = Record<string, unknown>;

const PROVIDER_REQUEST_TIMEOUT_MS = 60_000;

export const providerAdapters: ProviderAdapterRegistry = {
  openai: {
    providerKey: "openai",
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    parseAuthProfile: parseApiKey,
    checkHealth: (input) => checkOpenAiHealth(input.authProfile, "https://api.openai.com/v1/models"),
    async createResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "OpenAI");
      const data = await postJson("https://api.openai.com/v1/responses", {
        authorization: `Bearer ${profile.apiKey}`,
      }, {
        model: input.model,
        input: input.prompt,
        ...(input.instructions ? { instructions: input.instructions } : {}),
      });
      const text = requireText(collectText(data.output_text ?? data.output), "OpenAI");
      return { text, rawResponseJson: JSON.stringify(data) };
    },
  },
  anthropic: {
    providerKey: "anthropic",
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    parseAuthProfile: parseApiKey,
    async checkHealth(input) {
      const profile = requireApiKeyProfile(input.authProfile, "Anthropic");
      await getJson("https://api.anthropic.com/v1/models", {
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
      });
      return healthy();
    },
    async createResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, "Anthropic");
      const data = await postJson("https://api.anthropic.com/v1/messages", {
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
      }, {
        model: input.model,
        max_tokens: 4096,
        ...(input.instructions ? { system: input.instructions } : {}),
        messages: [{ role: "user", content: input.prompt }],
      });
      const text = requireText(collectText(data.content), "Anthropic");
      return { text, rawResponseJson: JSON.stringify(data) };
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
    parseAuthProfile: parseAzureProfile,
    async checkHealth(input) {
      const profile = requireAzureProfile(input.authProfile);
      await getJson(`${profile.baseUrl}/openai/deployments?api-version=2024-10-21`, { "api-key": profile.apiKey });
      return healthy();
    },
  },
  "aws-bedrock": {
    providerKey: "aws-bedrock",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    parseAuthProfile: parseBedrockProfile,
    checkHealth: async (input) => {
      requireBedrockProfile(input.authProfile);
      return healthy();
    },
  },
  "vertex-ai": {
    providerKey: "vertex-ai",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    parseAuthProfile: parseVertexProfile,
    checkHealth: async (input) => {
      requireVertexProfile(input.authProfile);
      return healthy();
    },
  },
};

async function postJson(endpoint: string, headers: Record<string, string>, body: JsonRecord): Promise<JsonRecord> {
  return requestJson(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function getJson(endpoint: string, headers: Record<string, string>): Promise<JsonRecord> {
  return requestJson(endpoint, { method: "GET", headers });
}

async function requestJson(endpoint: string, init: RequestInit): Promise<JsonRecord> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  const raw = await response.text();
  const data = parseProviderJson(raw, response.ok);
  if (!response.ok) {
    const message = readProviderError(data) ?? (raw.trim() || `Provider request failed with HTTP ${response.status}.`);
    throw new Error(message);
  }
  return data;
}

function parseProviderJson(raw: string, requireJson: boolean): JsonRecord {
  if (!raw.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    if (!requireJson) return {};
    throw error;
  }
  if (!isRecord(value)) throw new Error("Provider returned invalid JSON.");
  return value;
}

function readProviderError(data: JsonRecord): string | null {
  const error = data.error;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectText(item));
  if (!isRecord(value)) return [];
  const direct = ["text", "output_text", "content"].flatMap((key) => collectText(value[key]));
  return direct.length > 0 ? direct : Object.values(value).flatMap((item) => collectText(item));
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
    parseAuthProfile: parseApiKey,
    checkHealth: (input) => checkOpenAiHealth(input.authProfile, healthUrl),
    async createResponse(input) {
      const profile = requireApiKeyProfile(input.authProfile, label);
      const messages = [
        ...(input.instructions ? [{ role: "system", content: input.instructions }] : []),
        { role: "user", content: input.prompt },
      ];
      const data = await postJson(endpoint, {
        authorization: `Bearer ${profile.apiKey}`,
      }, {
        model: input.model,
        messages,
      });
      const text = requireText(collectText(data.choices), label);
      return { text, rawResponseJson: JSON.stringify(data) };
    },
  };
}

async function checkOpenAiHealth(authProfile: ProviderAuthProfile, healthUrl: string): Promise<ProviderHealthResult> {
  const profile = requireApiKeyProfile(authProfile, "OpenAI-compatible provider");
  await getJson(healthUrl, { authorization: `Bearer ${profile.apiKey}` });
  return healthy();
}

function browserTokenAdapter(providerKey: string, authType: ProviderAuthType): ProviderAdapter {
  return {
    providerKey,
    authType,
    parseAuthProfile: authType === PROVIDER_AUTH_TYPE.ACCOUNT_SUBSCRIPTION ? parseAccountToken : parseAccessToken,
    checkHealth: async (input) => {
      if (authType === PROVIDER_AUTH_TYPE.ACCOUNT_SUBSCRIPTION) requireAccountTokenProfile(input.authProfile);
      else requireAccessTokenProfile(input.authProfile);
      return healthy();
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

function healthy(): ProviderHealthResult {
  return { checkedAt: new Date().toISOString() };
}
