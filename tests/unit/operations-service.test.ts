import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OperationsService } from "../../src/main/services/operations-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters, type ProviderAdapterRegistry } from "../../src/main/services/provider-adapters";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE } from "../../src/shared/domain";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-operations-${randomUUID()}.db`));
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

describe("operations service", () => {
  test("seeds feature flags, SLO targets, and chaos drills for new organizations", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);

    connection.transaction(() => {
      createOrganization(organization);
    });

    const state = snapshot.load();
    expect(state.featureFlags.map((flag) => flag.key).sort()).toEqual([
      "board_intervention",
      "chaos_drills",
      "provider_background_execution",
      "social_publish_approval",
    ]);
    expect(state.sloTargets.map((target) => target.signalKey)).toContain("browser_session_boundary");
    expect(state.chaosDrills).toHaveLength(4);
    connection.close();
  });

  test("feature flags gate provider background execution", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const operations = new OperationsService(connection.db);
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        createResponse: async () => ({ text: "accepted", rawResponseJson: "{}", rateLimitState: null }),
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";
    let flagId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      flagId = (connection.db.prepare("select id from feature_flags where org_id = ? and key = ?")
        .get(orgId, "provider_background_execution") as { id: string }).id;
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
      providers.updatePolicy({
        orgId,
        providerId: openAiProviderId,
        dataPolicy: PROVIDER_DATA_POLICY.STANDARD,
        backgroundEnabled: true,
        monthlyRequestLimit: 10,
        workspaceScope: "organization", contextWindowTokens: 128_000,
      });
      operations.setFeatureFlag({ orgId, flagId, enabled: false });
    });

    await expect(providers.createResponse({
      orgId,
      providerId: openAiProviderId,
      prompt: "Run background analysis",
      instructions: null,
      executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
    })).rejects.toThrow("Provider background execution is disabled by feature flag.");
    connection.close();
  });

  test("runs chaos drills and records operational signals", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const operations = new OperationsService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let drillId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      drillId = (connection.db.prepare("select id from chaos_drills where org_id = ? and scenario_key = ?")
        .get(orgId, "approval_backlog_gate") as { id: string }).id;
      operations.runChaosDrill({ orgId, drillId });
    });

    const state = snapshot.load();
    expect(state.chaosDrillRuns[0]).toMatchObject({ orgId, drillId, state: "passed" });
    expect(state.operationalEvents[0]).toMatchObject({ orgId, signalKey: "approval_route_coverage", source: "chaos_drill", success: true });
    expect(state.auditEvents.some((event) => event.entityType === "chaos_drill" && event.action === "run")).toBe(true);
    connection.close();
  });
});
