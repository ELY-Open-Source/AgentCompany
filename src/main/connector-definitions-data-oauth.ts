/**
 * OAuth-based pi-mono connectors.
 *
 * Each entry targets one of the five built-in pi-ai OAuth providers
 * (see `pi-mono-reference/packages/ai/src/utils/oauth/index.ts`). The
 * runtime opens the provider's browser auth flow, stores the refreshed
 * token in the `credentials` table, and passes it as the API key when
 * invoking pi-ai.
 *
 * The `oauthId` surfaced here matches pi-ai's five registered provider ids
 * verbatim (`anthropic` / `openai-codex` / `github-copilot` /
 * `google-gemini-cli` / `google-antigravity`) and is passed straight to
 * `getOAuthProvider`.
 */

import type { ConnectorDefinition } from "./connector-definitions";

export const OAUTH_CONNECTORS: ConnectorDefinition[] = [
  {
    id: "claude-pro",
    provider: "anthropic",
    label: "Claude Pro/Max",
    description:
      "Anthropic Claude via Claude Pro / Max subscription OAuth. Runs entirely through pi-mono's built-in OAuth handler; no API key required.",
    defaultModel: "claude-sonnet-4-5",
    auth: { type: "oauth", oauthId: "anthropic" },
    onboardingFeatured: true,
    notes:
      "Requires an active Claude Pro or Max subscription. Tokens refresh automatically.",
  },
  {
    id: "openai-codex",
    provider: "openai-codex",
    label: "ChatGPT Plus/Pro (Codex)",
    description:
      "OpenAI Codex via a ChatGPT Plus or Pro subscription. Personal-use only — production workloads should use the OpenAI API connector.",
    defaultModel: "gpt-5.3-codex",
    auth: { type: "oauth", oauthId: "openai-codex" },
    onboardingFeatured: true,
    notes: "Personal use only; requires ChatGPT Plus or Pro.",
  },
  {
    id: "github-copilot",
    provider: "github-copilot",
    label: "GitHub Copilot",
    description:
      "Models exposed through a GitHub Copilot subscription. Supports github.com and GitHub Enterprise Server.",
    defaultModel: "claude-opus-4.5",
    auth: { type: "oauth", oauthId: "github-copilot" },
    notes:
      "If a model shows 'not supported', enable it in VS Code: Copilot Chat → model selector → Enable.",
  },
  {
    id: "gemini-cli",
    provider: "google-gemini-cli",
    label: "Google Gemini CLI",
    description:
      "Google Gemini models via Cloud Code Assist OAuth. Free tier works with any Google account (rate-limited).",
    defaultModel: "gemini-2.5-pro",
    auth: { type: "oauth", oauthId: "google-gemini-cli" },
    notes:
      "For paid Cloud Code Assist, set GOOGLE_CLOUD_PROJECT. Google-gemini-cli OAuth provider id in pi-ai.",
  },
  {
    id: "antigravity",
    provider: "google-antigravity",
    label: "Google Antigravity",
    description:
      "Google Antigravity sandbox with Gemini 3, Claude, and GPT-OSS models. Free with any Google account.",
    defaultModel: "claude-sonnet-4-5",
    auth: { type: "oauth", oauthId: "google-antigravity" },
    notes: "Maps to pi-ai OAuth provider id `google-antigravity`.",
  },
];
