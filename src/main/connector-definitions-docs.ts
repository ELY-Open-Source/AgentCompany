/**
 * Per-auth-kind configuration documentation builders for the Settings →
 * Providers panel. Extracted from `connector-definitions.ts` to keep that
 * file under the 400-line cap.
 */

import type { PiOAuthProviderId } from "./connector-definitions";

export function buildOAuthDoc(label: string, oauthId: PiOAuthProviderId): string {
  return [
    `# ${label}`,
    "",
    "Authenticate via OAuth in your system browser. AgentCompany opens",
    "the provider's authorization page; the redirect handler runs locally on",
    "`http://localhost:53692/callback`.",
    "",
    `OAuth provider id: \`${oauthId}\`.`,
    "",
    "Tokens are encrypted by the OS keychain (or per-profile vault) and",
    "stored in the `credentials` table. Tokens are refreshed automatically",
    "before each run (60 second window).",
  ].join("\n");
}

export function buildApiKeyDoc(label: string, envVar: string): string {
  return [
    `# ${label}`,
    "",
    `API key authentication. Either paste the literal key or use a system`,
    `environment variable name (default: \`${envVar}\`).`,
    "",
    "Keys are encrypted at rest via OS keychain (or per-profile vault).",
  ].join("\n");
}

export function buildCloudDoc(label: string, body: string): string {
  return [`# ${label}`, "", body].join("\n");
}
