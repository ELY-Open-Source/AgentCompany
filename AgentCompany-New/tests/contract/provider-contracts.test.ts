import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { SdlcService } from "../../src/main/services/sdlc-service";
import { EVAL_SUITE_KEY, PROVIDER_AUTH_TYPE, SDLC_RUN_STATE } from "../../src/shared/domain";
import { PROVIDER_CATALOG } from "../../src/shared/provider-catalog";

const PROVIDER_SECRET_SAMPLES: Record<string, string> = {
  openai: "sk-live-provider",
  anthropic: "sk-live-provider",
  "claude-pro": "claude-session-token",
  xai: "sk-live-provider",
  groq: "sk-live-provider",
  mistral: "sk-live-provider",
  cerebras: "csk-live-provider",
  openrouter: "sk-or-live-provider",
  "github-copilot": "ghu_live_provider",
  "google-antigravity": "antigravity-session",
  "gpt-account": "chatgpt-session",
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

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-contract-${randomUUID()}.db`));
}

function createOrganization(organization: OrganizationService): string {
  return organization.createOrganization({
    organizationName: "Acme Operations",
    employeeName: "Dana Lee",
    mission: "Coordinate agents with auditable approvals.",
    goal: "Ship a verified control plane.",
  });
}

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
  });

  // Providers with no enumerable models endpoint keep returning the curated
  // catalog; the rest fetch live (covered offline by provider-models-fetch.test).
  const CURATED_MODEL_PROVIDERS = new Set([
    "github-copilot", "google-antigravity", "gpt-account", "azure-openai", "aws-bedrock", "vertex-ai",
  ]);

  test("exposes model listing and rate limit adapter contracts", async () => {
    for (const provider of PROVIDER_CATALOG) {
      const adapter = providerAdapters[provider.key];
      const authProfile = adapter.parseAuthProfile(PROVIDER_SECRET_SAMPLES[provider.key]);
      expect(typeof adapter.listModels).toBe("function");
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
      await expect(adapter.revoke({ authProfile: profile })).resolves.toBeUndefined();
      await expect(adapter.refresh({ authProfile: profile })).rejects.toThrow("does not support token refresh");
    }
  });

  test("runs the seeded contract eval suite", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const sdlc = new SdlcService(connection.db);
    let orgId = "";
    let suiteId = "";
    let runId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      suiteId = (connection.db.prepare("select id from eval_suites where org_id = ? and key = ?")
        .get(orgId, EVAL_SUITE_KEY.CONTRACT) as { id: string }).id;
      runId = sdlc.runEvalSuite({ orgId, suiteId });
    });

    const run = connection.db.prepare("select state, failed_count, result_json from eval_runs where id = ?")
      .get(runId) as { state: string; failed_count: number; result_json: string };
    const result = JSON.parse(run.result_json) as { checks: Array<{ key: string; passed: boolean }> };
    expect(run).toMatchObject({ state: SDLC_RUN_STATE.PASSED, failed_count: 0 });
    expect(result.checks.map((check) => check.key).sort()).toEqual([
      "provider_adapter_coverage",
      "provider_rate_limit_registry",
      "provider_runtime_contract",
      "schema_version",
    ]);
    expect(result.checks.every((check) => check.passed)).toBe(true);
    connection.close();
  });
});
