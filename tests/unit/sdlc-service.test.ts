import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SdlcService } from "../../src/main/services/sdlc-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { IPC_CHANNELS } from "../../src/shared/ipc";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-sdlc-${randomUUID()}.db`));
}

function createOrganization(organization: OrganizationService): string {
  return organization.createOrganization({
    organizationName: "Acme Operations",
    employeeName: "Dana Lee",
    mission: "Coordinate agents with auditable approvals.",
    goal: "Ship a verified control plane.",
  });
}

describe("SDLC service", () => {
  test("offers no review or eval whose pass only counts configuration rows", () => {
    const connection = createConnection();
    connection.transaction(() => {
      createOrganization(new OrganizationService(connection.db));
    });
    const tables = connection.db.prepare(`
      select name from sqlite_master where type = 'table' and name in ('sdlc_review_agents', 'sdlc_review_runs', 'eval_suites', 'eval_cases', 'eval_runs')
    `).all();
    expect(tables).toEqual([]);
    expect(Object.keys(IPC_CHANNELS).filter((name) => name === "runSdlcReview" || name === "runEvalSuite")).toEqual([]);
    connection.close();
  });

  test("seeds PR bot gates and toggles them", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const sdlc = new SdlcService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let gateId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      gateId = (connection.db.prepare("select id from pr_bot_gates where org_id = ? and key = ?")
        .get(orgId, "static_checks") as { id: string }).id;
      sdlc.setPrBotGate({ orgId, gateId, enabled: false });
    });

    const state = snapshot.load();
    expect(state.prBotGates.map((gate) => gate.key).sort()).toEqual(["human_approval", "migration_diff", "policy_diff", "static_checks"]);
    expect(state.prBotGates.find((gate) => gate.id === gateId)?.enabled).toBe(false);
    expect(state.auditEvents.some((event) => event.entityType === "pr_bot_gate" && event.action === "updated")).toBe(true);
    connection.close();
  });
});
