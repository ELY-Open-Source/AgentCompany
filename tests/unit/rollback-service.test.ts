import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { AuditService } from "../../src/main/services/audit-service";
import { MigrationService } from "../../src/main/services/migration-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { RollbackService } from "../../src/main/services/rollback-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-rollback-${randomUUID()}.db`));
}

function createLegacyDatabase(): string {
  const legacyPath = join(tmpdir(), `agentcompany-legacy-${randomUUID()}.db`);
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`
    create table organizations(id text primary key);
    insert into organizations(id) values ('legacy-org');
  `);
  legacy.close();
  return legacyPath;
}

describe("rollback service", () => {
  test("creates immutable rollback snapshots from migration reports and workspace manifests", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const migrations = new MigrationService(connection.db);
    const rollback = new RollbackService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const audit = new AuditService(connection.db);
    const legacyPath = createLegacyDatabase();
    let orgId = "";
    let employeeId = "";
    let reportId = "";
    let rollbackId = "";
    let reconciliationId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      seedWorkspace(connection.db, orgId);
      reportId = migrations.createReport({ orgId, sourceDatabasePath: legacyPath });
      audit.record({
        orgId,
        entityType: "task",
        entityId: "task-cutover",
        actorType: "employee",
        actorId: employeeId,
        action: "created",
        payload: { title: "Reconcile release delta" },
      });
      rollbackId = rollback.createSnapshot({ orgId, migrationReportId: reportId, createdByEmployeeId: employeeId });
      rollback.setActive({ orgId, snapshotId: rollbackId, active: true, employeeId });
      reconciliationId = (connection.db.prepare("select id from migration_reconciliation_items where org_id = ? limit 1")
        .get(orgId) as { id: string }).id;
      rollback.resolveReconciliationItem({ orgId, reconciliationItemId: reconciliationId, employeeId });
    });

    const state = snapshot.load();
    const record = state.rollbackSnapshots[0];
    if (!record) throw new Error("Rollback snapshot was not created.");
    const workspaceManifest = JSON.parse(record.workspaceManifestJson) as { workspaces: unknown[]; files: unknown[] };
    const deltaJournal = JSON.parse(record.deltaJournalJson) as unknown[];
    const restorePlan = JSON.parse(record.restorePlanJson) as { migrationReportId: string; restoreStrategy: string };
    expect(record).toMatchObject({ orgId, migrationReportId: reportId, active: true, createdByEmployeeId: employeeId });
    expect(record.sourceDatabaseSha256).toHaveLength(64);
    expect(record.workspaceManifestSha256).toHaveLength(64);
    expect(workspaceManifest.workspaces).toHaveLength(1);
    expect(workspaceManifest.files).toHaveLength(1);
    expect(deltaJournal.length).toBeGreaterThan(0);
    expect(restorePlan).toMatchObject({ migrationReportId: reportId, restoreStrategy: "legacy_snapshot_restore" });
    expect(state.migrationCutoverEvents.map((event) => event.eventType).sort()).toEqual([
      "migration_reconciliation_resolved",
      "rollback_snapshot_activated",
      "rollback_snapshot_created",
    ]);
    expect(state.migrationReconciliationItems).toContainEqual(expect.objectContaining({
      orgId,
      migrationReportId: reportId,
      rollbackSnapshotId: rollbackId,
      targetType: "task",
      targetId: "task-cutover",
      reason: "manual_delta_replay",
      state: "resolved",
      resolvedByEmployeeId: employeeId,
    }));
    expect(() => connection.transaction(() => rollback.resolveReconciliationItem({ orgId, reconciliationItemId: reconciliationId, employeeId })))
      .toThrow("Migration reconciliation item is already resolved.");
    expect(state.auditEvents.some((event) => event.entityType === "rollback_snapshot" && event.action === "activated")).toBe(true);
    expect(state.auditEvents.some((event) => event.entityType === "migration_reconciliation_item" && event.action === "resolved")).toBe(true);
    connection.close();
  });
});

function seedWorkspace(db: DatabaseSync, orgId: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    insert into workspaces(id, org_id, name, local_path, repo_url, repo_ref, project_id, is_primary, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, null, 1, ?, ?)
  `).run("wsp-rollback", orgId, "Primary", "C:\\repo\\workspace", "https://example.invalid/repo.git", "main", now, now);
  db.prepare(`
    insert into file_objects(
      id, org_id, name, kind, size_bytes, sha256, storage_path, owner_type, owner_id,
      created_at, pinned, space_id, updated_at, scan_state, scan_labels_json, scanned_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, null, ?, ?, ?, ?)
  `).run(
    "file-rollback",
    orgId,
    "release.txt",
    "document",
    12,
    "0".repeat(64),
    "artifacts/release.txt",
    "system",
    null,
    now,
    now,
    "approved",
    "[]",
    now,
  );
}
