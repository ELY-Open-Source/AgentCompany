import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters, type ProviderAdapterRegistry, type ProviderAuthProfile } from "../../src/main/services/provider-adapters";
import { SnapshotService } from "../../src/main/services/snapshot-service";
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
          return { checkedAt: new Date().toISOString() };
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

  test("records provider request results through direct execution adapters", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        checkHealth: async () => ({ checkedAt: new Date().toISOString() }),
        createResponse: async ({ authProfile, model, prompt }) => ({
          text: `${authProfile.type}:${model}:${prompt}`,
          rawResponseJson: JSON.stringify({ provider: "openai" }),
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
    expect(state.providers.find((provider) => provider.id === openAiProviderId)?.healthState).toBe("healthy");
    connection.close();
  });

  test("validates cloud auth profiles before saving credentials", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const providers = new ProviderService(connection.db);
    let orgId = "";
    let azureProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      azureProviderId = providerId(connection, orgId, "azure-openai");
    });

    expect(() => connection.transaction(() => providers.saveCredential({
      orgId,
      providerId: azureProviderId,
      secret: JSON.stringify({ baseUrl: "http://example.com", deployment: "gpt-5", secret: "key" }),
      model: "gpt-5",
    }))).toThrow("Azure base URL must use HTTPS.");
    connection.close();
  });
});
