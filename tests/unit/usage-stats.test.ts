import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { buildUsageStats } from "../../src/main/services/usage-stats";

describe("usage statistics", () => {
  test("periods cover every record of each org, beyond the snapshot's recent-list caps", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-usage-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const orgs: string[] = [];
    connection.transaction(() => {
      for (const name of ["Acme", "Beta"]) orgs.push(organization.createOrganization({ organizationName: name, employeeName: "Dana", mission: "m", goal: "g" }));
    });
    const now = new Date();
    const insert = connection.db.prepare(`
      insert into provider_requests(id, org_id, provider_id, provider_key, workspace_id, model, prompt_sha256, state, input_char_count, output_char_count,
        execution_mode, policy_decision, stream_event_count, created_at, input_tokens, output_tokens, cost_cents)
      values (?, ?, ?, 'openai', null, 'm', 'sha', ?, 1, 1, 'foreground', 'allowed', 0, ?, ?, ?, ?)
    `);
    connection.transaction(() => {
      for (const [index, orgId] of orgs.entries()) {
        const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
        for (let call = 0; call < 150; call += 1) {
          const daysAgo = call % 20;
          const at = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
          insert.run(`preq_${index}_${call}`, orgId, providerId, call % 10 === 0 ? "failed" : "succeeded", at, call % 3 === 0 ? null : 100, call % 3 === 0 ? null : 10, 1);
        }
      }
    });
    const stats = buildUsageStats(connection.db, now);
    expect(stats.map((item) => item.orgId).sort()).toEqual([...orgs].sort());
    const acme = stats.find((item) => item.orgId === orgs[0])!;
    expect(acme.month).toMatchObject({ requests: 150, failures: 15, callsWithoutUsage: 50, inputTokens: 100 * 100 });
    expect(acme.days).toHaveLength(7);
    const weekCalls = Array.from({ length: 150 }, (_, call) => call % 20).filter((daysAgo) => daysAgo < 7).length;
    expect(acme.days.reduce((sum, day) => sum + day.callsWithoutUsage, 0) + acme.days.reduce((sum, day) => sum + day.tokens, 0) / 110).toBe(weekCalls);
    expect(acme.providerActivity).toEqual([{ providerId: expect.any(String), requests: 150, failures: 15 }]);
    connection.close();
  });

  test("day buckets follow calendar days across a daylight-saving change, and 30 days is a rolling window", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    const connection = new DatabaseConnection(join(tmpdir(), `ac-usage-dst-${randomUUID()}.db`));
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    const insert = connection.db.prepare(`
      insert into provider_requests(id, org_id, provider_id, provider_key, workspace_id, model, prompt_sha256, state, input_char_count, output_char_count,
        execution_mode, policy_decision, stream_event_count, created_at, input_tokens, output_tokens)
      values (?, ?, ?, 'openai', null, 'm', 'sha', 'succeeded', 1, 1, 'foreground', 'allowed', 0, ?, 1, 0)
    `);
    // 2026-03-09 00:30 New York is right after the spring-forward night; 29 days 23 hours before "now" is still inside 30 days.
    const now = new Date("2026-03-12T12:00:00-04:00");
    insert.run("preq_dst", orgId, providerId, new Date("2026-03-09T00:30:00-04:00").toISOString());
    insert.run("preq_edge", orgId, providerId, new Date(now.getTime() - (30 * 24 - 1) * 3_600_000).toISOString());
    const stats = buildUsageStats(connection.db, now).find((item) => item.orgId === orgId)!;
    expect(stats.days.reduce((sum, day) => sum + day.tokens, 0)).toBe(1);
    expect(stats.month.requests).toBe(2);
    connection.close();
    process.env.TZ = previous;
  });
});
