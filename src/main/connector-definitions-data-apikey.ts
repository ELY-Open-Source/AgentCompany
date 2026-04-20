/**
 * API-key pi-mono connectors.
 *
 * Each entry maps to a pi-ai `KnownProvider` (see
 * `pi-mono-reference/packages/ai/src/env-api-keys.ts`) — except for the two
 * Fireworks entries, which are resolved locally in `src/main/model-resolver.ts`.
 *
 * `envKey` is the standard environment variable pi-mono reads when no
 * `auth.json` entry is present. AgentCompany's credential store also honours
 * it as a fallback so the Settings panel can tell users which variable to
 * set.
 */

import type { ConnectorDefinition } from "./connector-definitions";

export const API_KEY_CONNECTORS: ConnectorDefinition[] = [
  {
    id: "anthropic",
    provider: "anthropic",
    label: "Anthropic API",
    description:
      "Direct Anthropic Messages API. Use this for production workloads where OAuth subscription tiers are not appropriate.",
    defaultModel: "claude-sonnet-4-5",
    auth: { type: "api_key", envKey: "ANTHROPIC_API_KEY" },
    onboardingFeatured: true,
  },
  {
    id: "openai",
    provider: "openai",
    label: "OpenAI API",
    description:
      "OpenAI Responses + Chat Completions endpoints. Covers GPT-5 family and Codex deployments.",
    defaultModel: "gpt-5.4",
    auth: { type: "api_key", envKey: "OPENAI_API_KEY" },
    onboardingFeatured: true,
  },
  {
    id: "google",
    provider: "google",
    label: "Google Gemini API",
    description:
      "Google Gemini Generative Language API. Uses the standard GEMINI_API_KEY environment variable.",
    defaultModel: "gemini-2.5-pro",
    auth: { type: "api_key", envKey: "GEMINI_API_KEY" },
  },
  {
    id: "mistral",
    provider: "mistral",
    label: "Mistral",
    description: "Mistral La Plateforme — Codestral, Devstral, and Mistral Medium/Large families.",
    defaultModel: "mistral-medium-latest",
    auth: { type: "api_key", envKey: "MISTRAL_API_KEY" },
  },
  {
    id: "groq",
    provider: "groq",
    label: "Groq",
    description:
      "Groq LPU cloud. High-throughput inference for Llama 3, Qwen, DeepSeek, and Groq Compound.",
    defaultModel: "groq/compound",
    auth: { type: "api_key", envKey: "GROQ_API_KEY" },
  },
  {
    id: "cerebras",
    provider: "cerebras",
    label: "Cerebras",
    description: "Cerebras Inference cloud — wafer-scale hardware for Qwen, Llama, and GPT-OSS.",
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
    description:
      "OpenRouter aggregator. Access Anthropic, OpenAI, Google, open-weights, and community models through one key.",
    defaultModel: "anthropic/claude-sonnet-4.5",
    auth: { type: "api_key", envKey: "OPENROUTER_API_KEY" },
  },
  {
    id: "vercel-ai-gateway",
    provider: "vercel-ai-gateway",
    label: "Vercel AI Gateway",
    description:
      "Vercel's multi-provider proxy. Request models by `provider/model` slug and share one billing profile.",
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
    description:
      "OpenCode Zen managed endpoint. Pi-mono uses the same OPENCODE_API_KEY as OpenCode Go.",
    defaultModel: "claude-sonnet-4.5",
    auth: { type: "api_key", envKey: "OPENCODE_API_KEY" },
  },
  {
    id: "opencode-go",
    provider: "opencode-go",
    label: "OpenCode Go",
    description:
      "OpenCode Go managed endpoint. Shares OPENCODE_API_KEY with OpenCode Zen.",
    defaultModel: "kimi-k2.5",
    auth: { type: "api_key", envKey: "OPENCODE_API_KEY" },
  },
  {
    id: "huggingface",
    provider: "huggingface",
    label: "Hugging Face",
    description:
      "Hugging Face Inference Endpoints. Hosts Kimi K2, GLM, DeepSeek, MiniMax, and other open-weights.",
    defaultModel: "moonshotai/Kimi-K2.5",
    auth: { type: "api_key", envKey: "HF_TOKEN" },
  },
  {
    id: "kimi-coding",
    provider: "kimi-coding",
    label: "Kimi For Coding",
    description:
      "Moonshot AI Kimi For Coding endpoint — tuned for agentic coding workloads.",
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
    description: "MiniMax mainland China endpoint. Uses a separate key from the international tier.",
    defaultModel: "MiniMax-M2.7",
    auth: { type: "api_key", envKey: "MINIMAX_CN_API_KEY" },
  },
  {
    id: "fireworks",
    provider: "fireworks",
    label: "Fireworks AI",
    description:
      "Fireworks inference cloud. Resolved locally through `src/main/model-resolver.ts` — pi-ai does not ship a Fireworks catalog entry.",
    defaultModel: "accounts/fireworks/models/kimi-k2.5-turbo",
    auth: { type: "api_key", envKey: "FIREWORKS_API_KEY" },
  },
  {
    id: "fireworks-firepass",
    provider: "fireworks-firepass",
    label: "Fireworks Fire Pass",
    description:
      "Fireworks Fire Pass — $7/week subscription for unlimited Kimi K2.5 Turbo. Uses the same FIREWORKS_API_KEY; the Fire Pass entitlement is attached to the account.",
    defaultModel: "accounts/fireworks/routers/kimi-k2p5-turbo",
    auth: { type: "api_key", envKey: "FIREWORKS_API_KEY" },
    notes:
      "Fire Pass routes through the dedicated router id accounts/fireworks/routers/kimi-k2p5-turbo on both the OpenAI- and Anthropic-compat endpoints. See https://docs.fireworks.ai/firepass.",
  },
];
