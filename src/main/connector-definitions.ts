/**
 * Pi-mono connector catalog.
 *
 * The catalog is pure declarative data — there is no adapter module, no
 * embedded CLI command, and no capability matrix. All provider dispatch is
 * handled by pi-mono (`@mariozechner/pi-ai`) at runtime, which keys off the
 * `provider` field and the auth descriptor.
 *
 * Shape and invariants are validated by `tests/unit/connector-catalog.test.ts`:
 *
 *   - Exactly 26 entries: 5 OAuth, 18 API key, 3 Cloud
 *   - Each entry references a pi-ai `KnownProvider` (or one of the two
 *     Fireworks ids resolved locally in `src/main/model-resolver.ts`)
 *   - OAuth entries carry one of the five pi-ai OAuth provider ids
 *   - API-key entries carry an `envKey` environment variable name
 *   - The onboarding rail includes at least the `claude-pro` connector
 *
 * Entries live in three companion files to keep every module under the
 * 400-line cap:
 *
 *   - `connector-definitions-data-oauth.ts`   — 5 OAuth providers
 *   - `connector-definitions-data-apikey.ts`  — 18 API-key providers
 *   - `connector-definitions-data-cloud.ts`   — 3 Cloud providers
 */

import type { ConnectorId } from "@shared/types";
import { OAUTH_CONNECTORS } from "./connector-definitions-data-oauth";
import { API_KEY_CONNECTORS } from "./connector-definitions-data-apikey";
import { CLOUD_CONNECTORS } from "./connector-definitions-data-cloud";

/**
 * OAuth provider id recognised by the AgentCompany credential layer. These
 * match pi-ai's five built-in OAuth handler ids verbatim.
 */
export type PiOAuthProviderId =
  | "anthropic"
  | "openai-codex"
  | "github-copilot"
  | "google-gemini-cli"
  | "google-antigravity";

export type ConnectorAuthKind = "oauth" | "api_key" | "aws" | "azure" | "gcp_adc";

export interface ConnectorAuthOAuth {
  type: "oauth";
  oauthId: PiOAuthProviderId;
}

export interface ConnectorAuthApiKey {
  type: "api_key";
  /** Fallback environment variable name (e.g. `ANTHROPIC_API_KEY`). */
  envKey: string;
}

export interface ConnectorAuthAws {
  type: "aws";
}

export interface ConnectorAuthAzure {
  type: "azure";
}

export interface ConnectorAuthGcpAdc {
  type: "gcp_adc";
}

export type ConnectorAuth =
  | ConnectorAuthOAuth
  | ConnectorAuthApiKey
  | ConnectorAuthAws
  | ConnectorAuthAzure
  | ConnectorAuthGcpAdc;

export interface ConnectorDefinition {
  /** Stable AgentCompany id; the `connectors` table primary key. */
  id: ConnectorId;
  /** pi-ai `KnownProvider` id (or a locally-resolved provider for Fireworks). */
  provider: string;
  /** Human-readable label for the Settings panel and onboarding rail. */
  label: string;
  /** One-line explanation shown under the label. */
  description: string;
  /** pi-ai model id used when the user has not picked a model yet. */
  defaultModel: string;
  /** Declarative auth descriptor; drives the credential resolver and OAuth flow. */
  auth: ConnectorAuth;
  /** Whether to surface this connector in the first-run onboarding picker. */
  onboardingFeatured?: boolean;
  /** Optional extra guidance for the Settings panel. */
  notes?: string;
}

export const CONNECTORS: ConnectorDefinition[] = [
  ...OAUTH_CONNECTORS,
  ...API_KEY_CONNECTORS,
  ...CLOUD_CONNECTORS,
];
