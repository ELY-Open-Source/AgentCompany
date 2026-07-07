import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { parseProviderRateLimitHeaders, ProviderRateLimitRegistry } from "../../src/main/services/provider-rate-limit-registry";
import { SnapshotService } from "../../src/main/services/snapshot-service";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-provider-rate-limits-${randomUUID()}.db`));
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

describe("provider rate limit registry", () => {
  test("parses provider quota headers and retry-after hints", () => {
    const now = new Date("2026-05-23T12:00:00.000Z");
    const state = parseProviderRateLimitHeaders(new Headers({
      "x-ratelimit-limit-requests": "100",
      "x-ratelimit-remaining-requests": "42",
      "x-ratelimit-reset-requests": "2s",
      "retry-after": "1.5",
    }), now);

    expect(state).toEqual({
      requestLimit: 100,
      remainingRequests: 42,
      resetAt: "2026-05-23T12:00:02.000Z",
      retryAfterMs: 1500,
      rawStateJson: JSON.stringify({
        "x-ratelimit-limit-requests": "100",
        "x-ratelimit-remaining-requests": "42",
        "x-ratelimit-reset-requests": "2s",
        "retry-after": "1.5",
      }),
    });
  });

  test("persists observed quota state into snapshots", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const registry = new ProviderRateLimitRegistry(connection.db);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      registry.recordObservation({
        orgId,
        providerId: openAiProviderId,
        providerKey: "openai",
        model: "gpt-5.4",
        state: {
          requestLimit: 100,
          remainingRequests: 99,
          resetAt: "2026-05-23T12:10:00.000Z",
          retryAfterMs: null,
          rawStateJson: JSON.stringify({ "x-ratelimit-remaining-requests": "99" }),
        },
      });
    });

    expect(snapshot.load().providerRateLimitObservations[0]).toMatchObject({
      orgId,
      providerId: openAiProviderId,
      providerKey: "openai",
      model: "gpt-5.4",
      requestLimit: 100,
      remainingRequests: 99,
      resetAt: "2026-05-23T12:10:00.000Z",
      retryAfterMs: null,
      rawStateJson: JSON.stringify({ "x-ratelimit-remaining-requests": "99" }),
    });
    connection.close();
  });
});
