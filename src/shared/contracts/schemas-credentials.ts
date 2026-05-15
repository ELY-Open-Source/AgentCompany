import { z } from "zod";

export const credentialKindSchema = z.enum([
  "oauth",
  "api_key",
  "aws",
  "azure",
  "gcp_adc",
  "local",
]);

export const credentialStatusSchema = z.enum([
  "active",
  "expired",
  "revoked",
  "error",
  "not_configured",
]);

export const apiKeyValueSchema = z.object({
  source: z.enum(["literal", "env"]),
  value: z.string().min(1),
});

export const azureCredentialSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional().or(z.literal("")),
  resourceName: z.string().optional().or(z.literal("")),
  apiVersion: z.string().optional().or(z.literal("")),
  deploymentMap: z.record(z.string(), z.string()).optional(),
});

export const awsCredentialSchema = z.object({
  authMode: z.enum(["profile", "iam", "bearer"]),
  region: z.string().min(1).default("us-east-1"),
  awsProfile: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  sessionToken: z.string().optional(),
  bearerToken: z.string().optional(),
  forceCache: z.boolean().optional(),
  endpointUrl: z.string().optional(),
  skipAuth: z.boolean().optional(),
  forceHttp1: z.boolean().optional(),
});

export const gcpAdcCredentialSchema = z.object({
  project: z.string().min(1),
  location: z.string().min(1),
  credentialsPath: z.string().optional(),
});

function normalizeUrlHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  return trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) return null;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
  });
  if (octets.some((part) => part === null)) return null;
  return octets as [number, number, number, number];
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = parseIpv4(hostname);
  if (!octets) return false;
  const [first, second] = octets;
  return first === 10
    || first === 127
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254);
}

function isPrivateIpv6(hostname: string): boolean {
  if (hostname === "::1") return true;
  return /^f[cd][0-9a-f]{2}:/i.test(hostname) || /^fe80:/i.test(hostname);
}

export function isLocalConnectorBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const hostname = normalizeUrlHostname(url.hostname);
  if (hostname === "localhost") return true;
  return isPrivateIpv4(hostname) || isPrivateIpv6(hostname);
}

export const localBaseUrlSchema = z
  .string()
  .url()
  .refine(
    isLocalConnectorBaseUrl,
    "Local connector baseUrl must use HTTP(S) with localhost, loopback, or a private IP host.",
  );

export const localCredentialSchema = z.object({
  baseUrl: localBaseUrlSchema,
});

export const credentialPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("api_key"), value: apiKeyValueSchema }),
  z.object({ kind: z.literal("azure"), value: azureCredentialSchema }),
  z.object({ kind: z.literal("aws"), value: awsCredentialSchema }),
  z.object({ kind: z.literal("gcp_adc"), value: gcpAdcCredentialSchema }),
  z.object({ kind: z.literal("local"), value: localCredentialSchema }),
]);

export const saveCredentialInputSchema = z.object({
  connectorId: z.string().min(1),
  payload: credentialPayloadSchema,
});

export const removeCredentialInputSchema = z.object({
  connectorId: z.string().min(1),
});

export const testCredentialInputSchema = z.object({
  connectorId: z.string().min(1),
});

export const credentialSummarySchema = z.object({
  connectorId: z.string(),
  kind: credentialKindSchema,
  displayHint: z.string(),
  status: credentialStatusSchema,
  expiresAt: z.string().nullable(),
  lastRefreshedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export type CredentialSummary = z.infer<typeof credentialSummarySchema>;
export type SaveCredentialInput = z.infer<typeof saveCredentialInputSchema>;
export type AwsCredential = z.infer<typeof awsCredentialSchema>;
export type AzureCredential = z.infer<typeof azureCredentialSchema>;
export type GcpAdcCredential = z.infer<typeof gcpAdcCredentialSchema>;
export type LocalCredential = z.infer<typeof localCredentialSchema>;
export type ApiKeyValue = z.infer<typeof apiKeyValueSchema>;
