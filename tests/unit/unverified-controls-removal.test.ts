import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { IPC_CHANNELS } from "../../src/shared/ipc";

describe("SDLC controls", () => {
  test("offer no review, eval or PR gate that passes or blocks without checking real work", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `agentcompany-new-sdlc-${randomUUID()}.db`));
    connection.transaction(() => {
      new OrganizationService(connection.db).createOrganization({
        organizationName: "Acme Operations", employeeName: "Dana Lee", mission: "Coordinate agents.", goal: "Ship a verified control plane.",
      });
    });
    const tables = connection.db.prepare(`
      select name from sqlite_master
      where type = 'table' and name in ('sdlc_review_agents', 'sdlc_review_runs', 'eval_suites', 'eval_cases', 'eval_runs', 'pr_bot_gates')
    `).all();
    expect(tables).toEqual([]);
    expect(Object.keys(IPC_CHANNELS).filter((name) => ["runSdlcReview", "runEvalSuite", "setPrBotGate"].includes(name))).toEqual([]);
    connection.close();
  });
});

describe("rollback records", () => {
  test("offer no snapshot, cutover or reconciliation that marks a restore it never performs", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `agentcompany-new-rollback-${randomUUID()}.db`));
    const tables = connection.db.prepare(`
      select name from sqlite_master
      where type = 'table' and name in ('rollback_snapshots', 'migration_cutover_events', 'migration_reconciliation_items')
    `).all();
    expect(tables).toEqual([]);
    expect(Object.keys(IPC_CHANNELS).filter((name) => ["createRollbackSnapshot", "setRollbackSnapshotActive", "resolveMigrationReconciliation"].includes(name))).toEqual([]);
    connection.close();
  });
});
