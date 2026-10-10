import { describe, expect, test } from "vitest";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { PROVIDER_AUTH_TYPE } from "../../src/shared/domain";
import { PROVIDER_CATALOG } from "../../src/shared/provider-catalog";

const PROVIDER_SECRET_SAMPLES: Record<string, string> = {
  openai: "sk-live-provider",
  anthropic: "sk-live-provider",
  "claude-pro": JSON.stringify({ access: "live-access", refresh: "live-refresh", expires: 1_900_000_000_000 }),
  xai: "sk-live-provider",
  groq: "sk-live-provider",
  mistral: "sk-live-provider",
  cerebras: "csk-live-provider",
  openrouter: "sk-or-live-provider",
  kimi: "sk-live-provider",
  "kimi-cn": "sk-live-provider",
  "kimi-code": JSON.stringify({ access: "live-access", refresh: "live-refresh", expires: 1_900_000_000_000 }),
  "github-copilot": JSON.stringify({ access: "live-access", refresh: "live-refresh", expires: 1_900_000_000_000 }),
  "gpt-account": JSON.stringify({ access: "live-access", refresh: "live-refresh", expires: 1_900_000_000_000, accountId: "acct_1" }),
  "azure-openai": JSON.stringify({
    baseUrl: "https://acme.openai.azure.com",
    deployment: "gpt-5.4",
    secret: "azure-key",
  }),
  "aws-bedrock": JSON.stringify({
    region: "us-east-1",
    secret: JSON.stringify({ accessKeyId: "AKIA123", secretAccessKey: "aws-secret" }),
  }),
  "vertex-ai": JSON.stringify({
    projectId: "acme-ai",
    region: "us-central1",
    secret: JSON.stringify({ client_email: "agent@acme.iam.gserviceaccount.com", private_key: "key" }),
  }),
  "custom-openai": JSON.stringify({ baseUrl: "https://api.example.com/v1", secret: "sk-custom" }),
  "custom-anthropic": JSON.stringify({ baseUrl: "https://llm.example.com", secret: "sk-custom" }),
};

describe("provider contracts", () => {
  test("keeps provider catalog and adapters aligned", () => {
    expect(Object.keys(providerAdapters).sort()).toEqual(PROVIDER_CATALOG.map((provider) => provider.key).sort());
    for (const provider of PROVIDER_CATALOG) {
      const adapter = providerAdapters[provider.key];
      expect(adapter.providerKey).toBe(provider.key);
      expect(adapter.authType).toBe(provider.authType);
    }
  });

  test("parses credential profiles with required fields", () => {
    for (const provider of PROVIDER_CATALOG) {
      const profile = providerAdapters[provider.key].parseAuthProfile(PROVIDER_SECRET_SAMPLES[provider.key]);
      if (provider.authType === PROVIDER_AUTH_TYPE.API_KEY) expect(profile.type).toBe("api_key");
      if (provider.authType === PROVIDER_AUTH_TYPE.OAUTH_PKCE) expect(profile.type).toBe("access_token");
      if (provider.authType === PROVIDER_AUTH_TYPE.ACCOUNT_SUBSCRIPTION) expect(profile.type).toBe("account_token");
      if (provider.key === "azure-openai") expect(profile.type).toBe("azure_openai");
      if (provider.key === "aws-bedrock") expect(profile.type).toBe("aws_bedrock");
      if (provider.key === "vertex-ai") expect(profile.type).toBe("vertex_ai");
    }
  });

  test("rejects incomplete credential profiles", () => {
    for (const provider of PROVIDER_CATALOG) {
      const adapter = providerAdapters[provider.key];
      const secret = provider.authType === PROVIDER_AUTH_TYPE.CLOUD ? "{}" : " ";
      expect(() => adapter.parseAuthProfile(secret)).toThrow();
    }
    expect(() => providerAdapters["azure-openai"].parseAuthProfile(JSON.stringify({
      baseUrl: "http://acme.openai.azure.com",
      deployment: "gpt-5.4",
      secret: "azure-key",
    }))).toThrow("Azure base URL must use HTTPS.");
    for (const providerKey of ["custom-openai", "custom-anthropic"]) {
      expect(() => providerAdapters[providerKey].parseAuthProfile(JSON.stringify({
        baseUrl: "http://api.example.com/v1",
        secret: "sk-custom",
      }))).toThrow("Base URL must use HTTPS unless it is on this computer or the local network.");
      expect(() => providerAdapters[providerKey].parseAuthProfile(JSON.stringify({
        baseUrl: "https://user:token@api.example.com/v1",
        secret: "sk-custom",
      }))).toThrow("Base URL must not include credentials.");
      expect(() => providerAdapters[providerKey].parseAuthProfile(JSON.stringify({
        baseUrl: "https://api.example.com/v1?tenant=acme",
        secret: "sk-custom",
      }))).toThrow("Base URL must not include query strings or fragments.");
    }
  });

  // Providers with no enumerable models endpoint keep returning the curated
  // catalog; the rest fetch live (covered offline by provider-models-fetch.test).
  const CURATED_MODEL_PROVIDERS = new Set([
    "github-copilot", "gpt-account", "azure-openai", "aws-bedrock", "vertex-ai",
    "custom-openai", "custom-anthropic",
  ]);

  test("exposes model listing and rate limit adapter contracts", async () => {
    for (const provider of PROVIDER_CATALOG) {
      const adapter = providerAdapters[provider.key];
      const authProfile = adapter.parseAuthProfile(PROVIDER_SECRET_SAMPLES[provider.key]);
      expect(typeof adapter.listModels).toBe("function");
      expect(provider.supportsLiveModels).toBe(!CURATED_MODEL_PROVIDERS.has(provider.key));
      if (CURATED_MODEL_PROVIDERS.has(provider.key)) {
        await expect(adapter.listModels({ authProfile, model: provider.defaultModel })).resolves.toEqual(provider.models);
      }
      await expect(adapter.getRateLimitState({ authProfile, model: provider.defaultModel })).resolves.toBeNull();
      expect(typeof adapter.streamResponse).toBe("function");
      expect(typeof adapter.cancelResponse).toBe("function");
      expect(typeof adapter.createBackgroundResponse).toBe("function");
      expect(typeof adapter.retrieveResponse).toBe("function");
    }
  });

  test("exposes auth lifecycle adapter contracts", async () => {
    for (const provider of PROVIDER_CATALOG) {
      const adapter = providerAdapters[provider.key];
      const secret = PROVIDER_SECRET_SAMPLES[provider.key];
      const profile = adapter.parseAuthProfile(secret);
      await expect(adapter.authorize({ secret })).resolves.toEqual({ authProfile: profile });
      await expect(adapter.refresh({ authProfile: profile })).rejects.toThrow("does not support token refresh");
    }
  });
});
