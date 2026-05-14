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

export const localCredentialSchema = z.object({
  baseUrl: z.string().url(),
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
