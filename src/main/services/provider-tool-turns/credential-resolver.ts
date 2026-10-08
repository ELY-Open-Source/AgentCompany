/**
 * Resolves the per-request credential for a tool-use turn. API-key providers
 * pass the key straight through; OAuth/subscription providers parse the stored
 * credential JSON, refresh the access token when it has expired (persisting the
 * rotated token), and hand the turn a usable access token plus the extras
 * (accountId / projectId / enterpriseUrl) its backend needs.
 */
import { PROVIDER_AUTH_TYPE } from "../../../shared/domain";
import type { AuthBrokerService } from "../auth-broker-service";
import { loadCredential, type ProviderRow } from "../provider-internal";
import {
  parseAnthropicCompatProfile,
  parseApiKey,
  parseAzureProfile,
  parseBedrockProfile,
  parseOpenAiCompatProfile,
  parseVertexProfile,
  requireAnthropicCompatProfile,
  requireApiKeyProfile,
  requireAzureProfile,
  requireBedrockProfile,
  requireOpenAiCompatProfile,
  requireVertexProfile,
} from "../provider-auth-profiles";
import type { TurnCredential } from "../provider-tool-turn";
import type { OAuthCredentials } from "../oauth/oauth-types";
import { refreshCodex } from "../oauth/openai-codex-flow";
import { refreshClaudePro } from "../oauth/anthropic-claude-flow";
import { refreshAntigravity, requireAntigravityClientSecret } from "../oauth/google-antigravity-flow";
import type { IntegrationKeyStore } from "../integration-key-store";
import { refreshGitHubCopilotToken } from "../oauth/github-copilot-flow";
import { refreshKimiCode } from "../oauth/kimi-code-flow";
import { parseStoredOAuth, type StoredOAuth } from "../oauth/stored-oauth";

function refreshOAuth(providerKey: string, creds: StoredOAuth, keys: IntegrationKeyStore): Promise<OAuthCredentials> {
  switch (providerKey) {
    case "gpt-account":
      return refreshCodex(creds.refresh);
    case "claude-pro":
      return refreshClaudePro(creds.refresh);
    case "google-antigravity":
      return refreshAntigravity(creds.refresh, requireProjectId(creds), requireAntigravityClientSecret(keys.read("google_antigravity_client_secret")));
    case "github-copilot":
      return refreshGitHubCopilotToken(creds.refresh, creds.enterpriseUrl ?? undefined);
    case "kimi-code":
      return refreshKimiCode(creds.refresh);
    default:
      throw new Error(`${providerKey} cannot refresh its credential.`);
  }
}

function resolveCloudCredential(providerKey: string, secret: string): TurnCredential {
  switch (providerKey) {
    case "custom-openai": {
      const profile = requireOpenAiCompatProfile(parseOpenAiCompatProfile(secret));
      return { baseUrl: profile.baseUrl, ...(profile.apiKey ? { apiKey: profile.apiKey } : {}) };
    }
    case "custom-anthropic": {
      const profile = requireAnthropicCompatProfile(parseAnthropicCompatProfile(secret));
      return { baseUrl: profile.baseUrl, ...(profile.apiKey ? { apiKey: profile.apiKey } : {}) };
    }
    case "azure-openai": {
      const profile = requireAzureProfile(parseAzureProfile(secret));
      return { apiKey: profile.apiKey, baseUrl: profile.baseUrl, deployment: profile.deployment };
    }
    case "aws-bedrock": {
      const profile = requireBedrockProfile(parseBedrockProfile(secret));
      return { region: profile.region, accessKeyId: profile.accessKeyId, secretAccessKey: profile.secretAccessKey, sessionToken: profile.sessionToken };
    }
    case "vertex-ai": {
      const profile = requireVertexProfile(parseVertexProfile(secret));
      return { projectId: profile.projectId, region: profile.region, serviceAccountJson: profile.serviceAccountJson };
    }
    default:
      throw new Error(`${providerKey} does not support agent execution.`);
  }
}

function toTurnCredential(creds: StoredOAuth | OAuthCredentials): TurnCredential {
  const enterpriseUrl = creds.enterpriseUrl;
  return {
    accessToken: creds.access,
    accountId: typeof creds.accountId === "string" ? creds.accountId : undefined,
    projectId: typeof creds.projectId === "string" ? creds.projectId : undefined,
    enterpriseUrl: typeof enterpriseUrl === "string" ? enterpriseUrl : enterpriseUrl === null ? null : undefined,
  };
}

export async function resolveTurnCredential(deps: {
  authBroker: AuthBrokerService;
  integrationKeys: IntegrationKeyStore;
  orgId: string;
  provider: ProviderRow;
}): Promise<TurnCredential> {
  const secret = loadCredential(deps.authBroker, deps.orgId, deps.provider).secret;
  if (deps.provider.auth_type === PROVIDER_AUTH_TYPE.API_KEY) {
    return { apiKey: requireApiKeyProfile(parseApiKey(secret), deps.provider.provider_key).apiKey };
  }
  if (deps.provider.auth_type === PROVIDER_AUTH_TYPE.CLOUD) {
    return resolveCloudCredential(deps.provider.provider_key, secret);
  }
  const creds = parseStoredOAuth(deps.provider.provider_key, secret);
  if (Date.now() < creds.expires) return toTurnCredential(creds);
  if (!deps.provider.credential_id) throw new Error("Provider credential id is missing; reconnect the provider.");
  const refreshed = await refreshOAuth(deps.provider.provider_key, creds, deps.integrationKeys);
  deps.authBroker.updateProviderSecret({
    orgId: deps.orgId,
    providerKey: deps.provider.provider_key,
    credentialId: deps.provider.credential_id,
    secret: JSON.stringify(refreshed),
  });
  return toTurnCredential(refreshed);
}

function requireProjectId(creds: StoredOAuth): string {
  if (!creds.projectId) throw new Error("The Google Antigravity sign-in is missing its Google Cloud project id; sign in again.");
  return creds.projectId;
}
