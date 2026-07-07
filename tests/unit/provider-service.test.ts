import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { ProviderHttpError, providerAdapters, type ProviderAdapterRegistry, type ProviderAuthProfile } from "../../src/main/services/provider-adapters";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE } from "../../src/shared/domain";
import { PROVIDER_CATALOG } from "../../src/shared/provider-catalog";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-provider-${randomUUID()}.db`));
}

function createOrganization(organization: OrganizationService): string {
  return organization.createOrganization({
    organizationName: "Acme Operations",
    employeeName: "Dana Lee",
    mission: "Coordinate agents with auditable approvals.",
    goal: "Ship a verified control plane.",
  });
}

function providerId(connection: DatabaseConnection, orgId: string, key: string): string {
  return (connection.db.prepare("select id from providers where org_id = ? and provider_key = ?")
    .get(orgId, key) as { id: string }).id;
}

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("provider service", () => {
  test("registers an adapter for every catalog provider", () => {
    expect(Object.keys(providerAdapters).sort()).toEqual(PROVIDER_CATALOG.map((provider) => provider.key).sort());
    for (const provider of PROVIDER_CATALOG) {
      expect(providerAdapters[provider.key]?.authType).toBe(provider.authType);
    }
  });

  test("creates active auth broker profiles during credential rotation", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const providers = new ProviderService(connection.db, providerAdapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider-one", model: "gpt-5.4" });
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider-two", model: "gpt-5.4" });
    });

    const rows = connection.db.prepare(`
      select credential_id, display_hint, source_type, capability_json, active
      from provider_auth_profiles
      where org_id = ? and provider_id = ?
      order by active desc, created_at desc
    `).all(orgId, openAiProviderId) as Array<{
      credential_id: string;
      display_hint: string;
      source_type: string;
      capability_json: string;
      active: number;
    }>;
    const state = snapshot.load();
    const activeProfile = state.providerAuthProfiles.find((profile) => profile.providerId === openAiProviderId && profile.active);
    const provider = state.providers.find((item) => item.id === openAiProviderId);

    expect(rows.map((row) => row.active)).toEqual([1, 0]);
    expect(rows[0]).toMatchObject({ display_hint: "sk-liv...-two", source_type: "manual_secret" });
    expect(JSON.parse(rows[0].capability_json)).toMatchObject({ providerKey: "openai", capabilityTags: ["responses", "tools", "background"] });
    expect(provider?.credentialId).toBe(rows[0].credential_id);
    expect(activeProfile?.credentialId).toBe(rows[0].credential_id);
    expect(state.auditEvents.some((event) => event.entityType === "provider_auth_profile" && event.action === "created")).toBe(true);
    connection.close();
  });

  test("revokes active auth broker profiles and disables provider credentials", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const providers = new ProviderService(connection.db, providerAdapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
      providers.revokeCredential({ orgId, providerId: openAiProviderId });
    });

    await expect(providers.createResponse({
      orgId,
      providerId: openAiProviderId,
      prompt: "Draft board memo",
      instructions: null,
    })).rejects.toThrow("Provider credential is required.");

    const profileRows = connection.db.prepare(`
      select active
      from provider_auth_profiles
      where org_id = ? and provider_id = ?
    `).all(orgId, openAiProviderId) as Array<{ active: number }>;
    const credentialCount = connection.db.prepare(`
      select count(*) as count
      from credentials
      where org_id = ? and provider_key = 'openai'
    `).get(orgId) as { count: number };
    const state = snapshot.load();
    const provider = state.providers.find((item) => item.id === openAiProviderId);

    expect(profileRows).toEqual([{ active: 0 }]);
    expect(credentialCount.count).toBe(1);
    expect(provider).toMatchObject({
      credentialId: null,
      enabled: false,
      authState: "revoked",
      healthState: "unchecked",
      lastError: null,
      lastCheckedAt: null,
    });
    expect(state.providerAuthProfiles.find((profile) => profile.providerId === openAiProviderId)?.active).toBe(false);
    expect(state.auditEvents.some((event) => event.entityType === "provider_auth_profile" && event.action === "revoked")).toBe(true);
    expect(state.auditEvents.some((event) => event.entityType === "provider" && event.action === "credential_revoked")).toBe(true);
    connection.close();
  });

  test("checks provider health through its adapter", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let checkedProfile: ProviderAuthProfile | null = null;
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        checkHealth: async ({ authProfile }) => {
          checkedProfile = authProfile;
          return { checkedAt: new Date().toISOString(), rateLimitState: null };
        },
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
    });
    await providers.checkHealth(orgId, openAiProviderId);

    const state = snapshot.load();
    const provider = state.providers.find((item) => item.id === openAiProviderId);
    if (!provider) throw new Error("Provider was not found in snapshot.");
    expect(checkedProfile).toEqual({ type: "api_key", apiKey: "sk-live-provider" });
    expect(provider.healthState).toBe("healthy");
    expect(provider.lastCheckedAt).toHaveLength(24);
    expect(state.auditEvents.some((event) => event.entityType === "provider" && event.action === "health_checked")).toBe(true);
    connection.close();
  });

  test("audits provider sign-in launches with the employee actor", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let launched: { providerId: string; label: string; signInUrl: string; partition: string } | null = null;
    const providers = new ProviderService(connection.db, providerAdapters, testVault, (input) => { launched = input; });
    let orgId = "";
    let employeeId = "";
    let copilotProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      copilotProviderId = providerId(connection, orgId, "github-copilot");
    });

    expect(() => providers.launchSignInWindow({
      orgId,
      providerId: copilotProviderId,
      employeeId: "emp_missing",
    })).toThrow("Provider sign-in employee was not found.");

    connection.transaction(() => providers.launchSignInWindow({ orgId, providerId: copilotProviderId, employeeId }));

    const state = snapshot.load();
    expect(launched).toMatchObject({
      providerId: copilotProviderId,
      label: "GitHub Copilot",
      signInUrl: "https://github.com/login/device",
      partition: `persist:agentcompany-provider-${copilotProviderId}`,
    });
    expect(state.providerAuthSessions[0]).toMatchObject({
      orgId,
      providerId: copilotProviderId,
      providerKey: "github-copilot",
      employeeId,
      partition: `persist:agentcompany-provider-${copilotProviderId}`,
      completedAt: null,
    });
    expect(state.providerAuthSessions[0]?.state).toHaveLength(32);
    expect(state.providerAuthSessions[0]?.nonce).toHaveLength(32);
    expect(state.providerAuthSessions[0]?.codeVerifierSha256).toHaveLength(64);
    expect(state.auditEvents).toContainEqual(expect.objectContaining({
      entityType: "provider",
      entityId: copilotProviderId,
      actorType: "employee",
      actorId: employeeId,
      action: "sign_in_window_opened",
    }));
    connection.close();
  });

  test("binds OAuth credentials to a sign-in session source", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const providers = new ProviderService(connection.db, providerAdapters, testVault, () => {});
    let orgId = "";
    let employeeId = "";
    let copilotProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      copilotProviderId = providerId(connection, orgId, "github-copilot");
    });

    expect(() => connection.transaction(() => providers.saveCredential({
      orgId,
      providerId: copilotProviderId,
      secret: "ghu_live_provider",
      model: "claude-opus-4-5",
      employeeId,
    }))).toThrow("Provider sign-in session is required.");

    connection.transaction(() => {
      providers.launchSignInWindow({ orgId, providerId: copilotProviderId, employeeId });
      providers.saveCredential({
        orgId,
        providerId: copilotProviderId,
        secret: "ghu_live_provider",
        model: "claude-opus-4-5",
        employeeId,
      });
    });

    const state = snapshot.load();
    const profile = state.providerAuthProfiles.find((item) => item.providerId === copilotProviderId && item.active);
    const session = state.providerAuthSessions.find((item) => item.providerId === copilotProviderId);
    if (!profile || !session) throw new Error("Provider auth evidence was not created.");
    expect(profile).toMatchObject({ sourceType: "provider_sign_in_session", sourceRef: session.id });
    expect(session.completedAt).toBeTruthy();
    expect(state.providers.find((item) => item.id === copilotProviderId)?.enabled).toBe(true);
    connection.close();
  });

  test("records provider request results through direct execution adapters", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        checkHealth: async () => ({ checkedAt: new Date().toISOString(), rateLimitState: null }),
        createResponse: async ({ authProfile, model, prompt }) => ({
          text: `${authProfile.type}:${model}:${prompt}`,
          rawResponseJson: JSON.stringify({ provider: "openai" }),
          rateLimitState: null,
        }),
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
    });
    await providers.createResponse({
      orgId,
      providerId: openAiProviderId,
      prompt: "Draft board memo",
      instructions: "Return concise output.",
    });

    const state = snapshot.load();
    expect(state.providerRequests[0]).toMatchObject({
      providerId: openAiProviderId,
      providerKey: "openai",
      model: "gpt-5.4",
      responseText: "api_key:gpt-5.4:Draft board memo",
      state: "succeeded",
    });
    expect(state.operationalEvents[0]).toMatchObject({ signalKey: "provider_request_success", source: "provider_gateway", success: true });
    expect(state.providers.find((provider) => provider.id === openAiProviderId)?.healthState).toBe("healthy");
    connection.close();
  });

  test("records provider response rate limit observations", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        checkHealth: async () => ({ checkedAt: new Date().toISOString(), rateLimitState: null }),
        createResponse: async () => ({
          text: "accepted",
          rawResponseJson: "{}",
          rateLimitState: {
            requestLimit: 120,
            remainingRequests: 119,
            resetAt: "2026-05-23T12:00:00.000Z",
            retryAfterMs: null,
            rawStateJson: JSON.stringify({ "x-ratelimit-remaining-requests": "119" }),
          },
        }),
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
    });
    await providers.createResponse({
      orgId,
      providerId: openAiProviderId,
      prompt: "Draft board memo",
      instructions: null,
    });

    expect(snapshot.load().providerRateLimitObservations[0]).toMatchObject({
      orgId,
      providerId: openAiProviderId,
      providerKey: "openai",
      model: "gpt-5.4",
      requestLimit: 120,
      remainingRequests: 119,
      resetAt: "2026-05-23T12:00:00.000Z",
      retryAfterMs: null,
      rawStateJson: JSON.stringify({ "x-ratelimit-remaining-requests": "119" }),
    });
    connection.close();
  });

  test("records failed provider response rate limit observations", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        checkHealth: async () => ({ checkedAt: new Date().toISOString(), rateLimitState: null }),
        createResponse: async () => {
          throw new ProviderHttpError("rate limited", {
            requestLimit: 120,
            remainingRequests: 0,
            resetAt: "2026-05-23T12:00:00.000Z",
            retryAfterMs: 2000,
            rawStateJson: JSON.stringify({ "retry-after": "2" }),
          });
        },
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
    });
    await expect(providers.createResponse({
      orgId,
      providerId: openAiProviderId,
      prompt: "Draft board memo",
      instructions: null,
    })).rejects.toThrow("rate limited");

    const state = snapshot.load();
    expect(state.providerRequests[0]).toMatchObject({
      providerId: openAiProviderId,
      state: "failed",
      errorMessage: "rate limited",
    });
    expect(state.providerRateLimitObservations[0]).toMatchObject({
      orgId,
      providerId: openAiProviderId,
      providerKey: "openai",
      model: "gpt-5.4",
      requestLimit: 120,
      remainingRequests: 0,
      resetAt: "2026-05-23T12:00:00.000Z",
      retryAfterMs: 2000,
      rawStateJson: JSON.stringify({ "retry-after": "2" }),
    });
    connection.close();
  });

  test("tracks provider usage windows and enforces monthly request limits", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        checkHealth: async () => ({ checkedAt: new Date().toISOString(), rateLimitState: null }),
        createResponse: async ({ prompt }) => ({ text: `accepted:${prompt}`, rawResponseJson: "{}", rateLimitState: null }),
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
      providers.updatePolicy({
        orgId,
        providerId: openAiProviderId,
        dataPolicy: PROVIDER_DATA_POLICY.STANDARD,
        backgroundEnabled: false,
        monthlyRequestLimit: 1,
        workspaceScope: "organization",
      });
    });
    await providers.createResponse({
      orgId,
      providerId: openAiProviderId,
      prompt: "Draft board memo",
      instructions: null,
    });
    await expect(providers.createResponse({
      orgId,
      providerId: openAiProviderId,
      prompt: "Second board memo",
      instructions: null,
    })).rejects.toThrow("Provider monthly request limit has been reached.");

    const usage = connection.db.prepare(`
      select request_count, input_char_count, output_char_count
      from provider_usage_windows
      where org_id = ? and provider_id = ?
    `).get(orgId, openAiProviderId) as { request_count: number; input_char_count: number; output_char_count: number };
    expect(usage).toEqual({ request_count: 1, input_char_count: 16, output_char_count: 25 });
    const state = snapshot.load();
    expect(state.providerRequests[0]).toMatchObject({
      providerId: openAiProviderId,
      inputCharCount: 16,
      outputCharCount: 25,
      executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND,
      policyDecision: "allowed:standard:organization",
    });
    expect(state.providerRateLimits.find((item) => item.providerId === openAiProviderId)).toMatchObject({
      providerId: openAiProviderId,
      monthlyRequestLimit: 1,
      requestCount: 1,
      inputCharCount: 16,
      outputCharCount: 25,
      remainingRequestCount: 0,
      exhausted: true,
    });
    connection.close();
  });

  test("requires workspace context for workspace-scoped provider execution", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        checkHealth: async () => ({ checkedAt: new Date().toISOString(), rateLimitState: null }),
        createResponse: async ({ prompt }) => ({ text: `accepted:${prompt}`, rawResponseJson: "{}", rateLimitState: null }),
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";
    let workspaceId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      workspaceId = "wsp_release";
      const now = new Date().toISOString();
      connection.db.prepare(`
        insert into workspaces(id, org_id, name, local_path, repo_url, repo_ref, project_id, is_primary, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, null, ?, ?, ?)
      `).run(workspaceId, orgId, "Release", "C:/work/release", "https://example.com/release.git", "main", 1, now, now);
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
      providers.updatePolicy({
        orgId,
        providerId: openAiProviderId,
        dataPolicy: PROVIDER_DATA_POLICY.STANDARD,
        backgroundEnabled: false,
        monthlyRequestLimit: 10,
        workspaceScope: "workspace",
      });
    });

    await expect(providers.createResponse({
      orgId,
      providerId: openAiProviderId,
      prompt: "Draft workspace memo",
      instructions: null,
    })).rejects.toThrow("Provider workspace scope requires a workspace context.");
    expect(connection.db.prepare("select count(*) as count from provider_requests").get()).toEqual({ count: 0 });

    await providers.createResponse({
      orgId,
      providerId: openAiProviderId,
      workspaceId,
      prompt: "Draft workspace memo",
      instructions: null,
    });

    expect(snapshot.load().providerRequests[0]).toMatchObject({
      providerId: openAiProviderId,
      workspaceId,
      policyDecision: `allowed:standard:workspace:${workspaceId}`,
    });
    connection.close();
  });

  test("blocks background execution under zero data retention policy", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    let adapterCalled = false;
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        checkHealth: async () => ({ checkedAt: new Date().toISOString(), rateLimitState: null }),
        createResponse: async () => {
          adapterCalled = true;
          return { text: "blocked", rawResponseJson: "{}", rateLimitState: null };
        },
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
      providers.updatePolicy({
        orgId,
        providerId: openAiProviderId,
        dataPolicy: PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION,
        backgroundEnabled: false,
        monthlyRequestLimit: 10,
        workspaceScope: "organization",
      });
    });

    await expect(providers.createResponse({
      orgId,
      providerId: openAiProviderId,
      prompt: "Run background analysis",
      instructions: null,
      executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
    })).rejects.toThrow("Background execution conflicts with zero data retention policy.");
    expect(adapterCalled).toBe(false);
    expect(connection.db.prepare("select count(*) as count from provider_requests").get()).toEqual({ count: 0 });
    connection.close();
  });

  test("validates cloud auth profiles before saving credentials", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const providers = new ProviderService(connection.db);
    let orgId = "";
    let azureProviderId = "";
    let customOpenAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      azureProviderId = providerId(connection, orgId, "azure-openai");
      customOpenAiProviderId = providerId(connection, orgId, "custom-openai");
    });

    expect(() => connection.transaction(() => providers.saveCredential({
      orgId,
      providerId: azureProviderId,
      secret: JSON.stringify({ baseUrl: "http://example.com", deployment: "gpt-5", secret: "key" }),
      model: "gpt-5",
    }))).toThrow("Azure base URL must use HTTPS.");
    expect(() => connection.transaction(() => providers.saveCredential({
      orgId,
      providerId: customOpenAiProviderId,
      secret: JSON.stringify({ baseUrl: "http://api.example.com/v1", secret: "key" }),
      model: "gpt-5",
    }))).toThrow("Base URL must use HTTPS.");
    connection.close();
  });
});
