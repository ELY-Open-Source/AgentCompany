import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SdlcService } from "../../src/main/services/sdlc-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { SDLC_REVIEW_TARGET_TYPE } from "../../src/shared/domain";

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
  test("seeds review agents, eval suites, eval cases, and PR bot gates", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);

    connection.transaction(() => {
      createOrganization(organization);
    });

    const state = snapshot.load();
    expect(state.sdlcReviewAgents.map((agent) => agent.key).sort()).toEqual(["code_reviewer", "migration_reviewer", "policy_reviewer"]);
    expect(state.evalSuites.map((suite) => suite.key).sort()).toEqual(["contract", "integration", "replay"]);
    expect(state.evalCases).toHaveLength(6);
    expect(state.prBotGates.map((gate) => gate.key).sort()).toEqual(["human_approval", "migration_diff", "policy_diff", "static_checks"]);
    connection.close();
  });

  test("runs review agents against validated workspace targets", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const sdlc = new SdlcService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let reviewAgentId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      reviewAgentId = (connection.db.prepare("select id from sdlc_review_agents where org_id = ? and key = ?")
        .get(orgId, "code_reviewer") as { id: string }).id;
      sdlc.runReview({ orgId, reviewAgentId, targetType: SDLC_REVIEW_TARGET_TYPE.WORKSPACE, targetRef: orgId });
    });

    const state = snapshot.load();
    expect(state.sdlcReviewRuns[0]).toMatchObject({ orgId, reviewAgentId, targetType: SDLC_REVIEW_TARGET_TYPE.WORKSPACE, state: "passed" });
    expect(state.auditEvents.some((event) => event.entityType === "sdlc_review_run" && event.action === "created")).toBe(true);
    connection.close();
  });

  test("runs contract eval suites and toggles PR bot gates", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const sdlc = new SdlcService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let suiteId = "";
    let gateId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      suiteId = (connection.db.prepare("select id from eval_suites where org_id = ? and key = ?")
        .get(orgId, "contract") as { id: string }).id;
      gateId = (connection.db.prepare("select id from pr_bot_gates where org_id = ? and key = ?")
        .get(orgId, "static_checks") as { id: string }).id;
      sdlc.runEvalSuite({ orgId, suiteId });
      sdlc.setPrBotGate({ orgId, gateId, enabled: false });
    });

    const state = snapshot.load();
    expect(state.evalRuns[0]).toMatchObject({ orgId, suiteId, state: "passed", failedCount: 0 });
    expect(state.prBotGates.find((gate) => gate.id === gateId)?.enabled).toBe(false);
    expect(state.auditEvents.some((event) => event.entityType === "pr_bot_gate" && event.action === "updated")).toBe(true);
    connection.close();
  });
});
