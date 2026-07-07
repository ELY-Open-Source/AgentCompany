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
import { refreshAntigravity } from "../oauth/google-antigravity-flow";
import { refreshGitHubCopilotToken } from "../oauth/github-copilot-flow";

interface StoredOAuth {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  projectId?: string;
  enterpriseUrl?: string | null;
}

function parseStoredOAuth(secret: string): StoredOAuth {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    throw new Error("Stored OAuth credential is not valid JSON; reconnect the provider.");
  }
  const creds = parsed as StoredOAuth;
  if (typeof creds.access !== "string" || typeof creds.refresh !== "string" || typeof creds.expires !== "number") {
    throw new Error("Stored OAuth credential is incomplete; reconnect the provider.");
  }
  return creds;
}

function refreshOAuth(providerKey: string, creds: StoredOAuth): Promise<OAuthCredentials> {
  switch (providerKey) {
    case "gpt-account":
      return refreshCodex(creds.refresh);
    case "claude-pro":
      return refreshClaudePro(creds.refresh);
    case "google-antigravity":
      if (!creds.projectId) throw new Error("Antigravity credential is missing its project id; reconnect the provider.");
      return refreshAntigravity(creds.refresh, creds.projectId);
    case "github-copilot":
      return refreshGitHubCopilotToken(creds.refresh, creds.enterpriseUrl ?? undefined);
    default:
      throw new Error(`${providerKey} cannot refresh its credential.`);
  }
}

function resolveCloudCredential(providerKey: string, secret: string): TurnCredential {
  switch (providerKey) {
    case "custom-openai": {
      const profile = requireOpenAiCompatProfile(parseOpenAiCompatProfile(secret));
      return { apiKey: profile.apiKey, baseUrl: profile.baseUrl };
    }
    case "custom-anthropic": {
      const profile = requireAnthropicCompatProfile(parseAnthropicCompatProfile(secret));
      return { apiKey: profile.apiKey, baseUrl: profile.baseUrl };
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
  const creds = parseStoredOAuth(secret);
  if (Date.now() < creds.expires) return toTurnCredential(creds);
  if (!deps.provider.credential_id) throw new Error("Provider credential id is missing; reconnect the provider.");
  const refreshed = await refreshOAuth(deps.provider.provider_key, creds);
  deps.authBroker.updateProviderSecret({
    orgId: deps.orgId,
    providerKey: deps.provider.provider_key,
    credentialId: deps.provider.credential_id,
    secret: JSON.stringify(refreshed),
  });
  return toTurnCredential(refreshed);
}
