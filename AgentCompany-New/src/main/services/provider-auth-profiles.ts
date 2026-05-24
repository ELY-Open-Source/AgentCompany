import type { JsonRecord } from "./provider-http";
import { isRecord } from "./provider-http";

export type ProviderAuthProfile =
  | { type: "api_key"; apiKey: string }
  | { type: "access_token"; accessToken: string }
  | { type: "account_token"; accessToken: string }
  | { type: "azure_openai"; baseUrl: string; deployment: string; apiKey: string }
  | { type: "aws_bedrock"; region: string; accessKeyId: string; secretAccessKey: string; sessionToken: string | null }
  | { type: "vertex_ai"; projectId: string; region: string; serviceAccountJson: string };

export function parseApiKey(secret: string): ProviderAuthProfile {
  return { type: "api_key", apiKey: nonEmptySecret(secret, "API key") };
}

export function parseAccessToken(secret: string): ProviderAuthProfile {
  return { type: "access_token", accessToken: nonEmptySecret(secret, "Access token") };
}

export function parseAccountToken(secret: string): ProviderAuthProfile {
  return { type: "account_token", accessToken: nonEmptySecret(secret, "Account token") };
}

export function parseAzureProfile(secret: string): ProviderAuthProfile {
  const parsed = parseCloudSecret(secret);
  const baseUrl = requiredString(parsed.baseUrl, "Azure base URL").replace(/\/+$/, "");
  const deployment = requiredString(parsed.deployment, "Azure deployment");
  return { type: "azure_openai", baseUrl: normalizedHttpsUrl(baseUrl, "Azure base URL"), deployment, apiKey: requiredString(parsed.secret, "Azure API key") };
}

export function parseBedrockProfile(secret: string): ProviderAuthProfile {
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

export function parseVertexProfile(secret: string): ProviderAuthProfile {
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

export function requireApiKeyProfile(profile: ProviderAuthProfile, label: string): Extract<ProviderAuthProfile, { type: "api_key" }> {
  if (profile.type !== "api_key") throw new Error(`${label} API key profile is required.`);
  return profile;
}

export function requireAccessTokenProfile(profile: ProviderAuthProfile): Extract<ProviderAuthProfile, { type: "access_token" }> {
  if (profile.type !== "access_token") throw new Error("Access token profile is required.");
  return profile;
}

export function requireAccountTokenProfile(profile: ProviderAuthProfile): Extract<ProviderAuthProfile, { type: "account_token" }> {
  if (profile.type !== "account_token") throw new Error("Account token profile is required.");
  return profile;
}

export function requireAzureProfile(profile: ProviderAuthProfile): Extract<ProviderAuthProfile, { type: "azure_openai" }> {
  if (profile.type !== "azure_openai") throw new Error("Azure OpenAI profile is required.");
  return profile;
}

export function requireBedrockProfile(profile: ProviderAuthProfile): Extract<ProviderAuthProfile, { type: "aws_bedrock" }> {
  if (profile.type !== "aws_bedrock") throw new Error("AWS Bedrock profile is required.");
  return profile;
}

export function requireVertexProfile(profile: ProviderAuthProfile): Extract<ProviderAuthProfile, { type: "vertex_ai" }> {
  if (profile.type !== "vertex_ai") throw new Error("Vertex AI profile is required.");
  return profile;
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
