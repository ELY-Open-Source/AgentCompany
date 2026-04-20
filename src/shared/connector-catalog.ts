/**
 * Renderer-visible pi-mono connector catalog.
 *
 * Mirrors the authoritative definitions in `src/main/connector-definitions*.ts`
 * so the renderer can drive UI from the same 26-entry list without importing
 * Node/main-process modules. Keep this file in strict lockstep with the main
 * catalog when new connectors are added.
 */

import type { ConnectorId } from "./types/enums";

export type PiOAuthProviderId =
  | "anthropic"
  | "openai-codex"
  | "github-copilot"
  | "google-gemini-cli"
  | "google-antigravity";

export type ConnectorAuthKind = "oauth" | "api_key" | "aws" | "azure" | "gcp_adc";

export interface ConnectorAuthOAuth { type: "oauth"; oauthId: PiOAuthProviderId }
export interface ConnectorAuthApiKey { type: "api_key"; envKey: string }
export interface ConnectorAuthAws { type: "aws" }
export interface ConnectorAuthAzure { type: "azure" }
export interface ConnectorAuthGcpAdc { type: "gcp_adc" }

export type ConnectorAuth =
  | ConnectorAuthOAuth
  | ConnectorAuthApiKey
  | ConnectorAuthAws
  | ConnectorAuthAzure
  | ConnectorAuthGcpAdc;

export interface ConnectorCatalogEntry {
  id: ConnectorId;
  provider: string;
  label: string;
  description: string;
  defaultModel: string;
  auth: ConnectorAuth;
  onboardingFeatured?: boolean;
  notes?: string;
}

const OAUTH_ENTRIES: ConnectorCatalogEntry[] = [
  {
    id: "claude-pro",
    provider: "anthropic",
    label: "Claude Pro/Max",
    description: "Anthropic Claude via Claude Pro / Max subscription OAuth.",
    defaultModel: "claude-sonnet-4-5",
    auth: { type: "oauth", oauthId: "anthropic" },
    onboardingFeatured: true,
    notes: "Requires an active Claude Pro or Max subscription. Tokens refresh automatically.",
  },
  {
    id: "openai-codex",
    provider: "openai-codex",
    label: "ChatGPT Plus/Pro (Codex)",
    description: "OpenAI Codex via a ChatGPT Plus or Pro subscription.",
    defaultModel: "gpt-5.3-codex",
    auth: { type: "oauth", oauthId: "openai-codex" },
    onboardingFeatured: true,
    notes: "Personal use only; requires ChatGPT Plus or Pro.",
  },
  {
    id: "github-copilot",
    provider: "github-copilot",
    label: "GitHub Copilot",
    description: "Models exposed through a GitHub Copilot subscription.",
    defaultModel: "claude-opus-4.5",
    auth: { type: "oauth", oauthId: "github-copilot" },
    notes: "Supports github.com and GitHub Enterprise Server.",
  },
  {
    id: "gemini-cli",
    provider: "google-gemini-cli",
    label: "Google Gemini CLI",
    description: "Google Gemini models via Cloud Code Assist OAuth. Free tier works with any Google account.",
    defaultModel: "gemini-2.5-pro",
    auth: { type: "oauth", oauthId: "google-gemini-cli" },
    notes: "For paid Cloud Code Assist, set GOOGLE_CLOUD_PROJECT.",
  },
  {
    id: "antigravity",
    provider: "google-antigravity",
    label: "Google Antigravity",
    description: "Google Antigravity sandbox with Gemini 3, Claude, and GPT-OSS models.",
    defaultModel: "claude-sonnet-4-5",
    auth: { type: "oauth", oauthId: "google-antigravity" },
    notes: "Free with any Google account.",
  },
];

const API_KEY_ENTRIES: ConnectorCatalogEntry[] = [
  {
    id: "anthropic",
    provider: "anthropic",
    label: "Anthropic API",
    description: "Direct Anthropic Messages API for production workloads.",
    defaultModel: "claude-sonnet-4-5",
    auth: { type: "api_key", envKey: "ANTHROPIC_API_KEY" },
    onboardingFeatured: true,
  },
  {
    id: "openai",
    provider: "openai",
    label: "OpenAI API",
    description: "OpenAI Responses + Chat Completions endpoints. GPT-5 family and Codex deployments.",
    defaultModel: "gpt-5.4",
    auth: { type: "api_key", envKey: "OPENAI_API_KEY" },
    onboardingFeatured: true,
  },
  {
    id: "google",
    provider: "google",
    label: "Google Gemini API",
    description: "Google Gemini Generative Language API using the standard GEMINI_API_KEY variable.",
    defaultModel: "gemini-2.5-pro",
    auth: { type: "api_key", envKey: "GEMINI_API_KEY" },
  },
  {
    id: "mistral",
    provider: "mistral",
    label: "Mistral",
    description: "Mistral La Plateforme — Codestral, Devstral, Mistral Medium/Large families.",
    defaultModel: "mistral-medium-latest",
    auth: { type: "api_key", envKey: "MISTRAL_API_KEY" },
  },
  {
    id: "groq",
    provider: "groq",
    label: "Groq",
    description: "Groq LPU cloud. High-throughput inference for Llama 3, Qwen, DeepSeek, Groq Compound.",
    defaultModel: "groq/compound",
    auth: { type: "api_key", envKey: "GROQ_API_KEY" },
  },
  {
    id: "cerebras",
    provider: "cerebras",
    label: "Cerebras",
    description: "Cerebras Inference cloud — wafer-scale hardware for Qwen, Llama, GPT-OSS.",
    defaultModel: "qwen-3-235b-a22b-instruct-2507",
    auth: { type: "api_key", envKey: "CEREBRAS_API_KEY" },
  },
  {
    id: "xai",
    provider: "xai",
    label: "xAI",
    description: "xAI Grok API including Grok 4 Fast and Grok Code Fast.",
    defaultModel: "grok-4-fast",
    auth: { type: "api_key", envKey: "XAI_API_KEY" },
  },
  {
    id: "openrouter",
    provider: "openrouter",
    label: "OpenRouter",
    description: "OpenRouter aggregator — Anthropic, OpenAI, Google, open-weights through one key.",
    defaultModel: "anthropic/claude-sonnet-4.5",
    auth: { type: "api_key", envKey: "OPENROUTER_API_KEY" },
  },
  {
    id: "vercel-ai-gateway",
    provider: "vercel-ai-gateway",
    label: "Vercel AI Gateway",
    description: "Vercel multi-provider proxy using provider/model slugs on one billing profile.",
    defaultModel: "anthropic/claude-sonnet-4.5",
    auth: { type: "api_key", envKey: "AI_GATEWAY_API_KEY" },
  },
  {
    id: "zai",
    provider: "zai",
    label: "Z.AI",
    description: "Z.AI GLM-4.5/4.6 family — coding-tuned Chinese models with tool use.",
    defaultModel: "glm-4.6",
    auth: { type: "api_key", envKey: "ZAI_API_KEY" },
  },
  {
    id: "opencode",
    provider: "opencode",
    label: "OpenCode Zen",
    description: "OpenCode Zen managed endpoint. Shares OPENCODE_API_KEY with OpenCode Go.",
    defaultModel: "claude-sonnet-4.5",
    auth: { type: "api_key", envKey: "OPENCODE_API_KEY" },
  },
  {
    id: "opencode-go",
    provider: "opencode-go",
    label: "OpenCode Go",
    description: "OpenCode Go managed endpoint. Shares OPENCODE_API_KEY with OpenCode Zen.",
    defaultModel: "kimi-k2.5",
    auth: { type: "api_key", envKey: "OPENCODE_API_KEY" },
  },
  {
    id: "huggingface",
    provider: "huggingface",
    label: "Hugging Face",
    description: "Hugging Face Inference Endpoints — Kimi K2, GLM, DeepSeek, MiniMax, open-weights.",
    defaultModel: "moonshotai/Kimi-K2.5",
    auth: { type: "api_key", envKey: "HF_TOKEN" },
  },
  {
    id: "kimi-coding",
    provider: "kimi-coding",
    label: "Kimi For Coding",
    description: "Moonshot AI Kimi For Coding endpoint — tuned for agentic coding workloads.",
    defaultModel: "kimi-for-coding",
    auth: { type: "api_key", envKey: "KIMI_API_KEY" },
  },
  {
    id: "minimax",
    provider: "minimax",
    label: "MiniMax",
    description: "MiniMax international endpoint for M2 coding models.",
    defaultModel: "MiniMax-M2.7",
    auth: { type: "api_key", envKey: "MINIMAX_API_KEY" },
  },
  {
    id: "minimax-cn",
    provider: "minimax-cn",
    label: "MiniMax (China)",
    description: "MiniMax mainland China endpoint. Separate key from the international tier.",
    defaultModel: "MiniMax-M2.7",
    auth: { type: "api_key", envKey: "MINIMAX_CN_API_KEY" },
  },
  {
    id: "fireworks",
    provider: "fireworks",
    label: "Fireworks AI",
    description: "Fireworks inference cloud — Kimi K2.5 Turbo and more.",
    defaultModel: "accounts/fireworks/models/kimi-k2.5-turbo",
    auth: { type: "api_key", envKey: "FIREWORKS_API_KEY" },
  },
  {
    id: "fireworks-firepass",
    provider: "fireworks-firepass",
    label: "Fireworks Fire Pass",
    description: "Fireworks Fire Pass — subscription bundle. Same FIREWORKS_API_KEY.",
    defaultModel: "accounts/fireworks/routers/kimi-k2p5-turbo",
    auth: { type: "api_key", envKey: "FIREWORKS_API_KEY" },
    notes: "Fire Pass uses the dedicated router id accounts/fireworks/routers/kimi-k2p5-turbo documented at docs.fireworks.ai/firepass.",
  },
];

const CLOUD_ENTRIES: ConnectorCatalogEntry[] = [
  {
    id: "amazon-bedrock",
    provider: "amazon-bedrock",
    label: "AWS Bedrock",
    description: "Anthropic, Amazon Nova, and Llama models served through AWS Bedrock.",
    defaultModel: "us.anthropic.claude-sonnet-4-20250514-v1:0",
    auth: { type: "aws" },
    onboardingFeatured: true,
    notes: "Honours standard AWS credential discovery. Region defaults to us-east-1.",
  },
  {
    id: "azure-openai",
    provider: "azure-openai-responses",
    label: "Azure OpenAI",
    description: "Azure-hosted OpenAI deployments via the Responses API.",
    defaultModel: "gpt-5.4",
    auth: { type: "azure" },
    notes: "Provide AZURE_OPENAI_API_KEY plus AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME.",
  },
  {
    id: "google-vertex",
    provider: "google-vertex",
    label: "Google Vertex AI",
    description: "Gemini, Claude, and third-party models on Google Vertex AI using ADC.",
    defaultModel: "gemini-2.5-pro",
    auth: { type: "gcp_adc" },
    notes: "Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION.",
  },
];

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  ...OAUTH_ENTRIES,
  ...API_KEY_ENTRIES,
  ...CLOUD_ENTRIES,
];

export function findConnectorCatalogEntry(id: string): ConnectorCatalogEntry | undefined {
  return CONNECTOR_CATALOG.find((entry) => entry.id === id);
}

export function listFeaturedOnboardingConnectors(): ConnectorCatalogEntry[] {
  return CONNECTOR_CATALOG.filter((entry) => entry.onboardingFeatured === true);
}
