import { tableRows } from "../helpers/table-rows";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OperationsService } from "../../src/main/services/operations-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters, type ProviderAdapterRegistry } from "../../src/main/services/provider-adapters";
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
  test("seeds feature flags and SLO targets, and no drill that scores configuration as fault handling", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);

    connection.transaction(() => {
      createOrganization(organization);
    });

    expect(tableRows(connection.db, "feature_flags", "key asc", ["enabled"]).map((flag) => flag.key).sort()).toEqual([
      "board_intervention",
      "provider_background_execution",
      "social_publish_approval",
    ]);
    // Every SLO target is fed by a runtime source; none waits on a signal only a drill would write.
    expect(tableRows(connection.db, "slo_targets", "signal_key asc").map((target) => target.signalKey).sort()).toEqual([
      "approval_route_coverage", "migration_validation_success", "provider_request_success", "skill_resolve_success",
    ]);
    expect(connection.db.prepare("select name from sqlite_master where type = 'table' and name like 'chaos_drill%'").all()).toEqual([]);
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

  test("a signal's category comes from its runtime source, so a self-check cannot be filed as real traffic", () => {
    const connection = createConnection();
    const operations = new OperationsService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = createOrganization(new OrganizationService(connection.db));
    });
    operations.recordSignal({ orgId, source: "skill_resolver", success: true, durationMs: null, detail: {} });
    expect(connection.db.prepare("select signal_key, source from operational_events where org_id = ?").all(orgId))
      .toEqual([{ signal_key: "skill_resolve_success", source: "skill_resolver" }]);
    expect(() => operations.recordSignal({ orgId, source: "replay_eval" as "skill_resolver", success: true, durationMs: null, detail: {} }))
      .toThrow('"replay_eval" is not a runtime signal source.');
    connection.close();
  });
});
