import { getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import { getEnvApiKey } from "@mariozechner/pi-ai";
import { getConnectorDefinition } from "@main/connectors";
import { CredentialStore } from "./credential-store";
import type { OAuthCredentialPayload, StoredCredentialPayload } from "./types";

const REFRESH_WINDOW_MS = 60_000;

export class CredentialError extends Error {
  constructor(
    public readonly code: "CREDENTIAL_MISSING" | "CREDENTIAL_EXPIRED" | "CREDENTIAL_INVALID" | "CREDENTIAL_REFRESH_FAILED",
    public readonly connectorId: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CredentialError";
  }
}

export interface ResolvedCredential {
  apiKey: string;
  extraEnv?: Record<string, string>;
}

export class CredentialResolver {
  private readonly refreshLocks = new Map<string, Promise<void>>();

  constructor(private readonly store: CredentialStore) {}

  async resolve(connectorId: string): Promise<ResolvedCredential> {
    const definition = getConnectorDefinition(connectorId);
    if (!definition.auth) {
      throw new CredentialError("CREDENTIAL_INVALID", connectorId, `Connector ${connectorId} has no auth schema.`);
    }
    const auth = definition.auth;
    const stored = this.store.read(connectorId);

    switch (auth.type) {
      case "oauth": {
        if (!auth.oauthId) {
          throw new CredentialError("CREDENTIAL_INVALID", connectorId, `OAuth auth is missing oauthId.`);
        }
        if (stored?.kind !== "oauth") {
          throw new CredentialError("CREDENTIAL_MISSING", connectorId, `OAuth not yet completed for ${connectorId}.`);
        }
        await this.refreshIfNeeded(connectorId, auth.oauthId, stored.value);
        const fresh = this.store.read(connectorId);
        if (fresh?.kind !== "oauth") {
          throw new CredentialError("CREDENTIAL_INVALID", connectorId);
        }
        const provider = getOAuthProvider(auth.oauthId);
        if (!provider) throw new CredentialError("CREDENTIAL_INVALID", connectorId, `Unknown OAuth provider: ${auth.oauthId}`);
        return { apiKey: provider.getApiKey(fresh.value as never) };
      }
      case "api_key": {
        if (stored?.kind === "api_key") {
          if (stored.value.source === "literal") {
            return { apiKey: stored.value.value };
          }
          // Only the connector's own declared envKey may be read from process.env.
          // Arbitrary env var names would let a malicious payload exfil secrets
          // like CSC_KEY_PASSWORD or AWS_SECRET_ACCESS_KEY by routing them to a
          // provider as the "api key".
          if (stored.value.value !== auth.envKey) {
            throw new CredentialError(
              "CREDENTIAL_INVALID",
              connectorId,
              `Env var ${stored.value.value} is not permitted for connector ${connectorId}.`,
            );
          }
          const fromEnv = process.env[stored.value.value];
          if (!fromEnv) throw new CredentialError("CREDENTIAL_MISSING", connectorId, `Env var ${stored.value.value} is not set.`);
          return { apiKey: fromEnv };
        }
        if (!definition.provider) {
          throw new CredentialError("CREDENTIAL_MISSING", connectorId, `No credential or env API key for ${connectorId}.`);
        }
        const envKey = getEnvApiKey(definition.provider as never);
        if (!envKey) {
          throw new CredentialError("CREDENTIAL_MISSING", connectorId, `No credential or env API key for ${connectorId}.`);
        }
        return { apiKey: envKey };
      }
      case "azure": {
        if (stored?.kind !== "azure") {
          throw new CredentialError("CREDENTIAL_MISSING", connectorId);
        }
        const cfg = stored.value;
        const env: Record<string, string> = { AZURE_OPENAI_API_KEY: cfg.apiKey };
        if (cfg.baseUrl) env.AZURE_OPENAI_BASE_URL = cfg.baseUrl;
        if (cfg.resourceName) env.AZURE_OPENAI_RESOURCE_NAME = cfg.resourceName;
        if (cfg.apiVersion) env.AZURE_OPENAI_API_VERSION = cfg.apiVersion;
        if (cfg.deploymentMap && Object.keys(cfg.deploymentMap).length > 0) {
          env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP = Object.entries(cfg.deploymentMap)
            .map(([k, v]) => `${k}=${v}`)
            .join(",");
        }
        return { apiKey: cfg.apiKey, extraEnv: env };
      }
      case "aws": {
        if (stored?.kind !== "aws") {
          throw new CredentialError("CREDENTIAL_MISSING", connectorId);
        }
        const cfg = stored.value;
        const env: Record<string, string> = { AWS_REGION: cfg.region ?? "us-east-1" };
        if (cfg.authMode === "profile" && cfg.awsProfile) env.AWS_PROFILE = cfg.awsProfile;
        if (cfg.authMode === "iam") {
          if (!cfg.accessKeyId || !cfg.secretAccessKey) {
            throw new CredentialError("CREDENTIAL_INVALID", connectorId, "IAM auth requires both accessKeyId and secretAccessKey.");
          }
          env.AWS_ACCESS_KEY_ID = cfg.accessKeyId;
          env.AWS_SECRET_ACCESS_KEY = cfg.secretAccessKey;
          if (cfg.sessionToken) env.AWS_SESSION_TOKEN = cfg.sessionToken;
        }
        if (cfg.authMode === "bearer") {
          if (!cfg.bearerToken) {
            throw new CredentialError("CREDENTIAL_INVALID", connectorId, "Bearer auth requires a bearerToken.");
          }
          env.AWS_BEARER_TOKEN_BEDROCK = cfg.bearerToken;
        }
        if (cfg.forceCache) env.AWS_BEDROCK_FORCE_CACHE = "1";
        if (cfg.endpointUrl) env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME = cfg.endpointUrl;
        if (cfg.skipAuth) env.AWS_BEDROCK_SKIP_AUTH = "1";
        if (cfg.forceHttp1) env.AWS_BEDROCK_FORCE_HTTP1 = "1";
        return { apiKey: "", extraEnv: env };
      }
      case "gcp_adc": {
        if (stored?.kind !== "gcp_adc") {
          throw new CredentialError("CREDENTIAL_MISSING", connectorId);
        }
        const cfg = stored.value;
        const env: Record<string, string> = { GOOGLE_CLOUD_PROJECT: cfg.project, GOOGLE_CLOUD_LOCATION: cfg.location };
        if (cfg.credentialsPath) env.GOOGLE_APPLICATION_CREDENTIALS = cfg.credentialsPath;
        return { apiKey: "", extraEnv: env };
      }
      default: {
        const exhaustive: never = auth;
        throw new CredentialError("CREDENTIAL_INVALID", connectorId, `Unsupported auth descriptor: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private async refreshIfNeeded(connectorId: string, oauthId: string, creds: OAuthCredentialPayload): Promise<void> {
    if (typeof creds.expires !== "number" || !Number.isFinite(creds.expires)) return;
    if (Date.now() < creds.expires - REFRESH_WINDOW_MS) return;

    const existing = this.refreshLocks.get(connectorId);
    if (existing) {
      await existing;
      return;
    }

    const promise = (async () => {
      const provider = getOAuthProvider(oauthId);
      if (!provider) {
        throw new CredentialError("CREDENTIAL_INVALID", connectorId, `Unknown OAuth provider: ${oauthId}`);
      }
      try {
        const refreshed = await provider.refreshToken(creds as never);
        const payload: StoredCredentialPayload = { kind: "oauth", value: refreshed as OAuthCredentialPayload };
        const expiresAt = typeof refreshed.expires === "number" && Number.isFinite(refreshed.expires)
          ? new Date(refreshed.expires).toISOString()
          : null;
        this.store.saveRefreshedOAuth(connectorId, payload, expiresAt);
      } catch (error) {
        this.store.setStatus(connectorId, "expired", error instanceof Error ? error.message : String(error));
        throw new CredentialError("CREDENTIAL_REFRESH_FAILED", connectorId, error instanceof Error ? error.message : String(error));
      }
    })();

    this.refreshLocks.set(connectorId, promise);
    try {
      await promise;
    } finally {
      this.refreshLocks.delete(connectorId);
    }
  }
}
