import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderRequestStore } from "../../src/main/services/provider-request-store";
import { PROVIDER_EXECUTION_MODE } from "../../src/shared/domain";

describe("usage settlement", () => {
  test("every settled call records real tokens and cost on the request and in the month's totals", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-settle-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    });
    const provider = connection.db.prepare("select id, provider_key, data_policy, workspace_scope from providers where org_id = ? and provider_key = 'anthropic'").get(orgId) as
      { id: string; provider_key: string; data_policy: string; workspace_scope: string };
    connection.db.prepare("update providers set input_cents_per_mtok = 300, cached_input_cents_per_mtok = 30, output_cents_per_mtok = 1500 where id = ?").run(provider.id);
    const store = new ProviderRequestStore(connection.db);
    const call = () => store.create({
      orgId, provider: provider as never, model: "claude", workspaceId: null, promptSha256: "sha", inputCharCount: 40,
      executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND, createdAt: new Date().toISOString(),
    });
    const priced = call();
    store.settleUsage({
      orgId, requestId: priced, provider, inputCharCount: 40, outputCharCount: 12,
      rawResponseJson: JSON.stringify({ usage: { input_tokens: 600_000, output_tokens: 100_000, cache_read_input_tokens: 400_000 } }),
    });
    const silent = call();
    store.settleUsage({ orgId, requestId: silent, provider, inputCharCount: 10, outputCharCount: 3, rawResponseJson: JSON.stringify({ content: [] }) });

    expect(connection.db.prepare("select input_tokens, output_tokens, cached_input_tokens, cost_cents from provider_requests where id = ?").get(priced))
      .toEqual({ input_tokens: 1_000_000, output_tokens: 100_000, cached_input_tokens: 400_000, cost_cents: 180 + 12 + 150 });
    expect(connection.db.prepare(`
      select request_count, input_tokens, output_tokens, cached_input_tokens, cost_cents, requests_without_usage, unpriced_requests
      from provider_usage_windows where provider_id = ?
    `).get(provider.id)).toEqual({
      request_count: 2, input_tokens: 1_000_000, output_tokens: 100_000, cached_input_tokens: 400_000, cost_cents: 342, requests_without_usage: 1, unpriced_requests: 0,
    });
    connection.close();
  });
});
