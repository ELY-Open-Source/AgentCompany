import { PROVIDER_AUTH_TYPE, type ProviderCatalogEntry } from "./domain";

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    key: "openai",
    label: "OpenAI",
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    defaultModel: "gpt-5.1",
    capabilityTags: ["responses", "tools", "background"],
  },
  {
    key: "anthropic",
    label: "Anthropic",
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    defaultModel: "claude-sonnet-4-5",
    capabilityTags: ["messages", "tool-use", "token-bucket"],
  },
  {
    key: "xai",
    label: "xAI Grok",
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    defaultModel: "grok-4",
    capabilityTags: ["chat", "reasoning"],
  },
  {
    key: "github-copilot",
    label: "GitHub Copilot",
    authType: PROVIDER_AUTH_TYPE.OAUTH_PKCE,
    defaultModel: null,
    capabilityTags: ["account", "coding"],
  },
  {
    key: "google-antigravity",
    label: "Google Antigravity",
    authType: PROVIDER_AUTH_TYPE.OAUTH_PKCE,
    defaultModel: null,
    capabilityTags: ["account", "coding"],
  },
  {
    key: "gpt-account",
    label: "GPT account",
    authType: PROVIDER_AUTH_TYPE.ACCOUNT_SUBSCRIPTION,
    defaultModel: null,
    capabilityTags: ["codex", "subscription"],
  },
  {
    key: "azure-openai",
    label: "Azure OpenAI",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    defaultModel: null,
    capabilityTags: ["enterprise", "regional"],
  },
  {
    key: "aws-bedrock",
    label: "AWS Bedrock",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    defaultModel: null,
    capabilityTags: ["enterprise", "multi-model"],
  },
  {
    key: "vertex-ai",
    label: "Vertex AI",
    authType: PROVIDER_AUTH_TYPE.CLOUD,
    defaultModel: null,
    capabilityTags: ["enterprise", "regional"],
  },
  {
    key: "groq",
    label: "Groq",
    authType: PROVIDER_AUTH_TYPE.API_KEY,
    defaultModel: null,
    capabilityTags: ["inference", "low-latency"],
  },
];
