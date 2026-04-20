/**
 * Cloud pi-mono connectors.
 *
 * Cloud providers have bespoke credential discovery — multi-variable AWS /
 * Azure setups, or gcloud Application Default Credentials for Vertex. The
 * `auth.type` marker tells the credential resolver which discovery path to
 * run (see `pi-mono-reference/packages/ai/src/env-api-keys.ts`).
 */

import type { ConnectorDefinition } from "../connector-definitions";

export const CLOUD_CONNECTORS: ConnectorDefinition[] = [
  {
    id: "amazon-bedrock",
    provider: "amazon-bedrock",
    label: "AWS Bedrock",
    description:
      "Anthropic, Amazon Nova, and Llama models served through AWS Bedrock. Honours standard AWS credential discovery (profile, IAM keys, Bedrock bearer tokens, ECS roles, IRSA).",
    defaultModel: "us.anthropic.claude-sonnet-4-20250514-v1:0",
    auth: { type: "aws" },
    onboardingFeatured: true,
    notes:
      "Credentials resolved from AWS_PROFILE | AWS_ACCESS_KEY_ID+AWS_SECRET_ACCESS_KEY | AWS_BEARER_TOKEN_BEDROCK | AWS_CONTAINER_CREDENTIALS_* | AWS_WEB_IDENTITY_TOKEN_FILE. Region defaults to us-east-1.",
  },
  {
    id: "azure-openai",
    provider: "azure-openai-responses",
    label: "Azure OpenAI",
    description:
      "Azure-hosted OpenAI deployments via the Responses API. Requires AZURE_OPENAI_API_KEY plus a resource identifier.",
    defaultModel: "gpt-5.4",
    auth: { type: "azure" },
    notes:
      "Provide AZURE_OPENAI_API_KEY plus AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME. Optional AZURE_OPENAI_API_VERSION, AZURE_OPENAI_DEPLOYMENT_NAME_MAP.",
  },
  {
    id: "google-vertex",
    provider: "google-vertex",
    label: "Google Vertex AI",
    description:
      "Gemini, Claude, and third-party models on Google Vertex AI. Uses Application Default Credentials from `gcloud auth application-default login` or GOOGLE_APPLICATION_CREDENTIALS.",
    defaultModel: "gemini-2.5-pro",
    auth: { type: "gcp_adc" },
    notes:
      "Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION. Optional GOOGLE_CLOUD_API_KEY takes precedence over ADC when present.",
  },
];
