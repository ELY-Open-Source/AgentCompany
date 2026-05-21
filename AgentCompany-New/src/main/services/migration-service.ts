import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { CreateMigrationReportInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

const LEGACY_TABLES = [
  "organizations",
  "agents",
  "tasks",
  "approvals",
  "chat_messages",
  "providers",
  "skill_definitions",
  "file_objects",
  "social_accounts",
];

export class MigrationService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  createReport(input: CreateMigrationReportInput): string {
    if (!existsSync(input.sourceDatabasePath)) throw new Error("Source database was not found.");
    const source = new DatabaseSync(input.sourceDatabasePath, { readOnly: true });
    try {
      const availableTables = new Set(
        source.prepare("select name from sqlite_master where type = 'table'")
          .all()
          .map((row) => (row as { name: string }).name),
      );
      const tableCounts = Object.fromEntries(
        LEGACY_TABLES
          .filter((table) => availableTables.has(table))
          .map((table) => [table, countRows(source.prepare(`select count(*) as count from ${table}`))]),
      );
      const tableChecksums = Object.fromEntries(
        LEGACY_TABLES
          .filter((table) => availableTables.has(table))
          .map((table) => [table, tableChecksum(source, table)]),
      );
      const idMaps = Object.fromEntries(
        LEGACY_TABLES
          .filter((table) => availableTables.has(table))
          .map((table) => [table, tableIds(source, table)]),
      );
      const missingTables = LEGACY_TABLES.filter((table) => !availableTables.has(table));
      const failures = missingTables.map((table) => ({ table, reason: "missing_table" }));
      const reportId = createId("mig");
      const now = new Date().toISOString();
      this.db.prepare(`
        insert into migration_reports(id, org_id, source_ref, report_json, created_at)
        values (?, ?, ?, ?, ?)
      `).run(reportId, input.orgId, input.sourceDatabasePath, JSON.stringify({
        tableCounts,
        tableChecksums,
        idMaps,
        missingTables,
        failures,
        rollbackPack: {
          sourceDatabasePath: input.sourceDatabasePath,
          capturedAt: now,
          restoreStrategy: "legacy_snapshot_restore",
        },
      }), now);
      this.audit.record({
        orgId: input.orgId,
        entityType: "migration_report",
        entityId: reportId,
        actorType: "system",
        actorId: null,
        action: "created",
        payload: { sourceRef: input.sourceDatabasePath, tableCount: Object.keys(tableCounts).length },
      });
      return reportId;
    } finally {
      source.close();
    }
  }
}

function countRows(statement: StatementSync): number {
  return (statement.get() as { count: number }).count;
}

function tableChecksum(source: DatabaseSync, table: string): string {
  const hash = createHash("sha256");
  const rows = source.prepare(`select * from ${table} order by rowid`).all();
  for (const row of rows) hash.update(JSON.stringify(row));
  return hash.digest("hex");
}

function tableIds(source: DatabaseSync, table: string): string[] {
  const columns = source.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "id")) return [];
  return source.prepare(`select id from ${table} order by id`).all().map((row) => String((row as { id: unknown }).id));
}
