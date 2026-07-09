import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";

/**
 * The snapshot is serialized over IPC on every refresh, so its size is a
 * user-facing performance contract. A real profile once accumulated 144MB of
 * per-run compiled skill prompts that rode along on every load and froze the
 * whole app - these tests pin that regression class shut.
 */
describe("snapshot payload", () => {
  test("per-run compiled prompts and raw provider bodies never ride the snapshot", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-snapshot-payload-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
      const agentId = organization.createAgent({
        orgId, name: "Ada", role: "Engineer", department: "Engineering",
        modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null,
      });
      const providerId = (connection.db.prepare("select id from providers where org_id = ? limit 1").get(orgId) as { id: string }).id;
      const megabyte = "x".repeat(1_048_576);
      connection.db.prepare(`
        insert into skill_runtime_snapshots(id, agent_id, run_id, compiled_prompt, tools_manifest, source_revision_ids, created_at)
        values ('srs_fat', ?, 'run_fat', ?, '{}', '[]', ?)
      `).run(agentId, megabyte, new Date().toISOString());
      connection.db.prepare(`
        insert into provider_requests(id, org_id, provider_id, provider_key, model, prompt_sha256, response_text, raw_response_json, state, error_message, created_at, completed_at)
        values ('prq_fat', ?, ?, 'openai', 'gpt-5.4', 'sha', 'short answer', ?, 'succeeded', null, ?, ?)
      `).run(orgId, providerId, megabyte, new Date().toISOString(), new Date().toISOString());
    });

    const state = snapshot.load();
    expect(state).not.toHaveProperty("skillRuntimeSnapshots");
    expect(state).not.toHaveProperty("skillRevisions");
    const request = state.providerRequests.find((row) => row.id === "prq_fat");
    expect(request?.responseText).toBe("short answer");
    expect(request).not.toHaveProperty("rawResponseJson");
    // Two megabytes of database bloat must not translate into snapshot bytes.
    expect(JSON.stringify(state).length).toBeLessThan(400_000);
    connection.close();
  });
});
