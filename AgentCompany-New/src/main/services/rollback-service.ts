import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync, realpathSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { CreateRollbackSnapshotInput, SetRollbackSnapshotActiveInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

interface MigrationReportRow {
  id: string;
  source_ref: string;
  report_json: string;
  created_at: string;
}

interface MigrationReportBody {
  sourceFingerprint: string;
  rollbackPack: {
    sourceDatabasePath: string;
    restoreStrategy: string;
    sourceFingerprint: string;
  };
}

interface WorkspaceRow {
  id: string;
  name: string;
  local_path: string;
  repo_url: string;
  repo_ref: string;
  is_primary: number;
  updated_at: string;
}

interface FileRow {
  id: string;
  name: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  scan_state: string;
  updated_at: string | null;
}

interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  payload_json: string;
  created_at: string;
}

export class RollbackService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  createSnapshot(input: CreateRollbackSnapshotInput): string {
    this.requireEmployee(input.orgId, input.createdByEmployeeId);
    const report = this.requireReport(input.orgId, input.migrationReportId);
    const body = parseMigrationReport(report.report_json);
    const sourceDatabasePath = realSourcePath(body.rollbackPack.sourceDatabasePath);
    if (sourceDatabasePath !== realSourcePath(report.source_ref)) throw new Error("Rollback source path does not match the migration report.");
    if (body.sourceFingerprint !== body.rollbackPack.sourceFingerprint) throw new Error("Rollback pack fingerprint is invalid.");
    const sourceDatabaseSha256 = fileSha256(sourceDatabasePath);
    const workspaceManifestJson = JSON.stringify(this.workspaceManifest(input.orgId));
    const workspaceManifestSha256 = sha256(workspaceManifestJson);
    const deltaJournalJson = JSON.stringify(this.deltaJournal(input.orgId, report.created_at));
    const restorePlanJson = JSON.stringify({
      migrationReportId: report.id,
      sourceDatabasePath,
      sourceFingerprint: body.sourceFingerprint,
      sourceDatabaseSha256,
      workspaceManifestSha256,
      restoreStrategy: body.rollbackPack.restoreStrategy,
    });
    const id = createId("rbs");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into rollback_snapshots(
        id, org_id, migration_report_id, source_database_path, source_fingerprint,
        source_database_sha256, workspace_manifest_json, workspace_manifest_sha256,
        delta_journal_json, restore_plan_json, active, created_by_employee_id, created_at, activated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, null)
    `).run(
      id,
      input.orgId,
      report.id,
      sourceDatabasePath,
      body.sourceFingerprint,
      sourceDatabaseSha256,
      workspaceManifestJson,
      workspaceManifestSha256,
      deltaJournalJson,
      restorePlanJson,
      input.createdByEmployeeId,
      now,
    );
    this.audit.record({
      orgId: input.orgId,
      entityType: "rollback_snapshot",
      entityId: id,
      actorType: "employee",
      actorId: input.createdByEmployeeId,
      action: "created",
      payload: { migrationReportId: report.id, sourceFingerprint: body.sourceFingerprint },
    });
    return id;
  }

  setActive(input: SetRollbackSnapshotActiveInput): void {
    this.requireEmployee(input.orgId, input.employeeId);
    const snapshot = this.db.prepare("select id from rollback_snapshots where id = ? and org_id = ?")
      .get(input.snapshotId, input.orgId) as { id: string } | undefined;
    if (!snapshot) throw new Error("Rollback snapshot was not found.");
    const now = new Date().toISOString();
    if (input.active) this.db.prepare("update rollback_snapshots set active = 0, activated_at = null where org_id = ?").run(input.orgId);
    const result = this.db.prepare("update rollback_snapshots set active = ?, activated_at = ? where id = ? and org_id = ?")
      .run(input.active ? 1 : 0, input.active ? now : null, input.snapshotId, input.orgId);
    if (result.changes === 0) throw new Error("Rollback snapshot was not found.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "rollback_snapshot",
      entityId: input.snapshotId,
      actorType: "employee",
      actorId: input.employeeId,
      action: input.active ? "activated" : "deactivated",
      payload: { active: input.active },
    });
  }

  private requireReport(orgId: string, reportId: string): MigrationReportRow {
    const report = this.db.prepare("select id, source_ref, report_json, created_at from migration_reports where id = ? and org_id = ?")
      .get(reportId, orgId) as MigrationReportRow | undefined;
    if (!report) throw new Error("Migration report was not found.");
    return report;
  }

  private requireEmployee(orgId: string, employeeId: string): void {
    const employee = this.db.prepare("select id from employees where id = ? and org_id = ?").get(employeeId, orgId);
    if (!employee) throw new Error("Rollback employee was not found.");
  }

  private workspaceManifest(orgId: string): { workspaces: unknown[]; files: unknown[] } {
    const workspaces = this.db.prepare(`
      select id, name, local_path, repo_url, repo_ref, is_primary, updated_at
      from workspaces
      where org_id = ?
      order by id asc
    `).all(orgId) as unknown as WorkspaceRow[];
    const files = this.db.prepare(`
      select id, name, size_bytes, sha256, storage_path, scan_state, updated_at
      from file_objects
      where org_id = ?
      order by id asc
    `).all(orgId) as unknown as FileRow[];
    return {
      workspaces: workspaces.map((row) => ({
        id: row.id,
        name: row.name,
        localPath: row.local_path,
        repoUrl: row.repo_url,
        repoRef: row.repo_ref,
        isPrimary: row.is_primary === 1,
        updatedAt: row.updated_at,
      })),
      files: files.map((row) => ({
        id: row.id,
        name: row.name,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        storagePath: row.storage_path,
        scanState: row.scan_state,
        updatedAt: row.updated_at,
      })),
    };
  }

  private deltaJournal(orgId: string, since: string): unknown[] {
    const rows = this.db.prepare(`
      select id, entity_type, entity_id, actor_type, actor_id, action, payload_json, created_at
      from audit_events
      where org_id = ? and created_at >= ?
      order by created_at asc, id asc
    `).all(orgId, since) as unknown as AuditRow[];
    return rows.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      payload: parseRecord(row.payload_json),
      createdAt: row.created_at,
    }));
  }
}

function parseMigrationReport(reportJson: string): MigrationReportBody {
  const parsed = parseRecord(reportJson);
  const rollbackPack = parsed.rollbackPack;
  if (typeof parsed.sourceFingerprint !== "string") throw new Error("Migration report is missing a source fingerprint.");
  if (typeof rollbackPack !== "object" || rollbackPack === null || Array.isArray(rollbackPack)) throw new Error("Migration report is missing a rollback pack.");
  const pack = rollbackPack as Record<string, unknown>;
  if (typeof pack.sourceDatabasePath !== "string" || typeof pack.restoreStrategy !== "string" || typeof pack.sourceFingerprint !== "string") {
    throw new Error("Migration rollback pack is invalid.");
  }
  return {
    sourceFingerprint: parsed.sourceFingerprint,
    rollbackPack: {
      sourceDatabasePath: pack.sourceDatabasePath,
      restoreStrategy: pack.restoreStrategy,
      sourceFingerprint: pack.sourceFingerprint,
    },
  };
}

function realSourcePath(path: string): string {
  if (!existsSync(path)) throw new Error("Rollback source database was not found.");
  return realpathSync.native(path);
}

function fileSha256(path: string): string {
  const fd = openSync(path, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const bytes = readSync(fd, buffer, 0, buffer.length, null);
      if (bytes === 0) return hash.digest("hex");
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(fd);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseRecord(json: string): Record<string, unknown> {
  const parsed = JSON.parse(json) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("JSON record is invalid.");
  return parsed as Record<string, unknown>;
}
