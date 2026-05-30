import { githubCopilotFlow } from "./github-copilot-flow";
import { openaiCodexFlow } from "./openai-codex-flow";
import { antigravityFlow } from "./google-antigravity-flow";
import type { OAuthFlow } from "./oauth-types";

/** Provider keys (from the catalog) mapped to their native OAuth login flow. */
const OAUTH_FLOWS: Record<string, OAuthFlow> = {
  "github-copilot": githubCopilotFlow,
  "gpt-account": openaiCodexFlow,
  "google-antigravity": antigravityFlow,
};

export function hasOAuthFlow(providerKey: string): boolean {
  return providerKey in OAUTH_FLOWS;
}

export function getOAuthFlow(providerKey: string): OAuthFlow {
  const flow = OAUTH_FLOWS[providerKey];
  if (!flow) throw new Error(`${providerKey} does not support interactive sign-in.`);
  return flow;
}
