import { existsSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { CreateMigrationReportInput } from "../../shared/commands";
import { SLO_SIGNAL_KEY } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { OperationsService } from "./operations-service";

const LEGACY_TABLES = [
  "organizations",
  "org_departments",
  "hiring_policies",
  "employees",
  "employee_identities",
  "service_identities",
  "role_grants",
  "access_decisions",
  "agents",
  "tasks",
  "workspaces",
  "goals",
  "projects",
  "task_runs",
  "approvals",
  "approval_routing_rules",
  "approval_assignments",
  "feature_flags",
  "slo_targets",
  "operational_events",
  "chaos_drills",
  "chaos_drill_runs",
  "sdlc_review_agents",
  "sdlc_review_runs",
  "eval_suites",
  "eval_cases",
  "eval_runs",
  "pr_bot_gates",
  "chat_spaces",
  "chat_messages",
  "chat_threads",
  "chat_memberships",
  "chat_attachments",
  "chat_mentions",
  "chat_slash_invocations",
  "board_interventions",
  "chat_presence",
  "chat_read_state",
  "providers",
  "provider_requests",
  "provider_usage_windows",
  "credentials",
  "skill_definitions",
  "skill_revisions",
  "skill_artifacts",
  "skill_tests",
  "skill_dependencies",
  "skill_bindings",
  "skill_runtime_snapshots",
  "skill_catalog_tags",
  "file_objects",
  "file_access_grants",
  "social_accounts",
  "social_account_grants",
  "browser_actions",
  "scheduled_posts",
  "policy_rules",
  "compliance_exports",
  "legal_holds",
  "retention_freezes",
  "search_documents",
  "audit_events",
];

interface MigrationFailure {
  table: string;
  reason: string;
  detail: string;
}

interface RelationCheck {
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  reason: string;
}

interface MigrationReportBody {
  sourceFingerprint: string;
  tableCounts: Record<string, number>;
  tableChecksums: Record<string, string>;
  idMaps: Record<string, string[]>;
  missingTables: string[];
  failures: MigrationFailure[];
  rollbackPack: {
    sourceDatabasePath: string;
    capturedAt: string;
    restoreStrategy: string;
    sourceFingerprint: string;
    tableChecksums: Record<string, string>;
    idMaps: Record<string, string[]>;
  };
}

const RELATION_CHECKS: RelationCheck[] = [
  { table: "org_departments", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "org_departments", column: "lead_agent_id", referencedTable: "agents", referencedColumn: "id", reason: "dangling_lead_agent_id" },
  { table: "hiring_policies", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "employees", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "employee_identities", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "employee_identities", column: "employee_id", referencedTable: "employees", referencedColumn: "id", reason: "dangling_employee_id" },
  { table: "service_identities", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "service_identities", column: "agent_id", referencedTable: "agents", referencedColumn: "id", reason: "dangling_agent_id" },
  { table: "role_grants", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "role_grants", column: "granted_by_employee_id", referencedTable: "employees", referencedColumn: "id", reason: "dangling_grantor_employee_id" },
  { table: "access_decisions", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "agents", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "agents", column: "model_provider_id", referencedTable: "providers", referencedColumn: "id", reason: "dangling_model_provider_id" },
  { table: "agents", column: "manager_agent_id", referencedTable: "agents", referencedColumn: "id", reason: "dangling_manager_agent_id" },
  { table: "agents", column: "workspace_id", referencedTable: "workspaces", referencedColumn: "id", reason: "dangling_workspace_id" },
  { table: "tasks", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "tasks", column: "assignee_agent_id", referencedTable: "agents", referencedColumn: "id", reason: "dangling_assignee_agent_id" },
  { table: "tasks", column: "project_id", referencedTable: "projects", referencedColumn: "id", reason: "dangling_project_id" },
  { table: "tasks", column: "goal_id", referencedTable: "goals", referencedColumn: "id", reason: "dangling_goal_id" },
  { table: "tasks", column: "workspace_id", referencedTable: "workspaces", referencedColumn: "id", reason: "dangling_workspace_id" },
  { table: "workspaces", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "workspaces", column: "project_id", referencedTable: "projects", referencedColumn: "id", reason: "dangling_project_id" },
  { table: "goals", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "goals", column: "owner_agent_id", referencedTable: "agents", referencedColumn: "id", reason: "dangling_owner_agent_id" },
  { table: "projects", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "projects", column: "goal_id", referencedTable: "goals", referencedColumn: "id", reason: "dangling_goal_id" },
  { table: "projects", column: "lead_agent_id", referencedTable: "agents", referencedColumn: "id", reason: "dangling_lead_agent_id" },
  { table: "task_runs", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "task_runs", column: "task_id", referencedTable: "tasks", referencedColumn: "id", reason: "dangling_task_id" },
  { table: "task_runs", column: "agent_id", referencedTable: "agents", referencedColumn: "id", reason: "dangling_agent_id" },
  { table: "task_runs", column: "provider_id", referencedTable: "providers", referencedColumn: "id", reason: "dangling_provider_id" },
  { table: "approvals", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "approvals", column: "decided_by_employee_id", referencedTable: "employees", referencedColumn: "id", reason: "dangling_decider_id" },
  { table: "approval_routing_rules", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "approval_assignments", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "approval_assignments", column: "approval_id", referencedTable: "approvals", referencedColumn: "id", reason: "dangling_approval_id" },
  { table: "approval_assignments", column: "routing_rule_id", referencedTable: "approval_routing_rules", referencedColumn: "id", reason: "dangling_routing_rule_id" },
  { table: "feature_flags", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "slo_targets", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "operational_events", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "chaos_drills", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "chaos_drill_runs", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "chaos_drill_runs", column: "drill_id", referencedTable: "chaos_drills", referencedColumn: "id", reason: "dangling_drill_id" },
  { table: "sdlc_review_agents", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "sdlc_review_runs", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "sdlc_review_runs", column: "review_agent_id", referencedTable: "sdlc_review_agents", referencedColumn: "id", reason: "dangling_review_agent_id" },
  { table: "eval_suites", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "eval_cases", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "eval_cases", column: "suite_id", referencedTable: "eval_suites", referencedColumn: "id", reason: "dangling_suite_id" },
  { table: "eval_runs", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "eval_runs", column: "suite_id", referencedTable: "eval_suites", referencedColumn: "id", reason: "dangling_suite_id" },
  { table: "pr_bot_gates", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "chat_spaces", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "chat_messages", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "chat_messages", column: "space_id", referencedTable: "chat_spaces", referencedColumn: "id", reason: "dangling_space_id" },
  { table: "chat_messages", column: "thread_id", referencedTable: "chat_threads", referencedColumn: "id", reason: "dangling_thread_id" },
  { table: "chat_threads", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "chat_threads", column: "space_id", referencedTable: "chat_spaces", referencedColumn: "id", reason: "dangling_space_id" },
  { table: "chat_threads", column: "root_message_id", referencedTable: "chat_messages", referencedColumn: "id", reason: "dangling_root_message_id" },
  { table: "chat_memberships", column: "space_id", referencedTable: "chat_spaces", referencedColumn: "id", reason: "dangling_space_id" },
  { table: "chat_attachments", column: "message_id", referencedTable: "chat_messages", referencedColumn: "id", reason: "dangling_message_id" },
  { table: "chat_attachments", column: "file_id", referencedTable: "file_objects", referencedColumn: "id", reason: "dangling_file_id" },
  { table: "chat_mentions", column: "message_id", referencedTable: "chat_messages", referencedColumn: "id", reason: "dangling_message_id" },
  { table: "chat_slash_invocations", column: "message_id", referencedTable: "chat_messages", referencedColumn: "id", reason: "dangling_message_id" },
  { table: "board_interventions", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "board_interventions", column: "thread_id", referencedTable: "chat_threads", referencedColumn: "id", reason: "dangling_thread_id" },
  { table: "board_interventions", column: "message_id", referencedTable: "chat_messages", referencedColumn: "id", reason: "dangling_message_id" },
  { table: "board_interventions", column: "approval_id", referencedTable: "approvals", referencedColumn: "id", reason: "dangling_approval_id" },
  { table: "chat_read_state", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "chat_read_state", column: "employee_id", referencedTable: "employees", referencedColumn: "id", reason: "dangling_employee_id" },
  { table: "chat_read_state", column: "space_id", referencedTable: "chat_spaces", referencedColumn: "id", reason: "dangling_space_id" },
  { table: "chat_read_state", column: "last_read_message_id", referencedTable: "chat_messages", referencedColumn: "id", reason: "dangling_last_read_message_id" },
  { table: "providers", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "providers", column: "credential_id", referencedTable: "credentials", referencedColumn: "id", reason: "dangling_credential_id" },
  { table: "provider_requests", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "provider_requests", column: "provider_id", referencedTable: "providers", referencedColumn: "id", reason: "dangling_provider_id" },
  { table: "provider_usage_windows", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "provider_usage_windows", column: "provider_id", referencedTable: "providers", referencedColumn: "id", reason: "dangling_provider_id" },
  { table: "credentials", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "skill_definitions", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "skill_revisions", column: "skill_id", referencedTable: "skill_definitions", referencedColumn: "id", reason: "dangling_skill_id" },
  { table: "skill_artifacts", column: "revision_id", referencedTable: "skill_revisions", referencedColumn: "id", reason: "dangling_revision_id" },
  { table: "skill_tests", column: "revision_id", referencedTable: "skill_revisions", referencedColumn: "id", reason: "dangling_revision_id" },
  { table: "skill_dependencies", column: "revision_id", referencedTable: "skill_revisions", referencedColumn: "id", reason: "dangling_revision_id" },
  { table: "skill_dependencies", column: "depends_on_revision_id", referencedTable: "skill_revisions", referencedColumn: "id", reason: "dangling_depends_on_revision_id" },
  { table: "skill_bindings", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "skill_bindings", column: "agent_id", referencedTable: "agents", referencedColumn: "id", reason: "dangling_agent_id" },
  { table: "skill_bindings", column: "skill_id", referencedTable: "skill_definitions", referencedColumn: "id", reason: "dangling_skill_id" },
  { table: "skill_bindings", column: "pinned_revision_id", referencedTable: "skill_revisions", referencedColumn: "id", reason: "dangling_revision_id" },
  { table: "skill_runtime_snapshots", column: "agent_id", referencedTable: "agents", referencedColumn: "id", reason: "dangling_agent_id" },
  { table: "skill_runtime_snapshots", column: "run_id", referencedTable: "task_runs", referencedColumn: "id", reason: "dangling_run_id" },
  { table: "skill_catalog_tags", column: "skill_id", referencedTable: "skill_definitions", referencedColumn: "id", reason: "dangling_skill_id" },
  { table: "file_objects", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "file_objects", column: "space_id", referencedTable: "chat_spaces", referencedColumn: "id", reason: "dangling_space_id" },
  { table: "file_access_grants", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "file_access_grants", column: "file_id", referencedTable: "file_objects", referencedColumn: "id", reason: "dangling_file_id" },
  { table: "file_access_grants", column: "source_message_id", referencedTable: "chat_messages", referencedColumn: "id", reason: "dangling_source_message_id" },
  { table: "file_access_grants", column: "source_thread_id", referencedTable: "chat_threads", referencedColumn: "id", reason: "dangling_source_thread_id" },
  { table: "social_accounts", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "social_accounts", column: "authorized_employee_id", referencedTable: "employees", referencedColumn: "id", reason: "dangling_authorized_employee_id" },
  { table: "social_account_grants", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "social_account_grants", column: "social_account_id", referencedTable: "social_accounts", referencedColumn: "id", reason: "dangling_social_account_id" },
  { table: "social_account_grants", column: "employee_id", referencedTable: "employees", referencedColumn: "id", reason: "dangling_employee_id" },
  { table: "browser_actions", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "browser_actions", column: "social_account_id", referencedTable: "social_accounts", referencedColumn: "id", reason: "dangling_social_account_id" },
  { table: "browser_actions", column: "evidence_file_id", referencedTable: "file_objects", referencedColumn: "id", reason: "dangling_evidence_file_id" },
  { table: "scheduled_posts", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "scheduled_posts", column: "social_account_id", referencedTable: "social_accounts", referencedColumn: "id", reason: "dangling_social_account_id" },
  { table: "scheduled_posts", column: "approval_id", referencedTable: "approvals", referencedColumn: "id", reason: "dangling_approval_id" },
  { table: "scheduled_posts", column: "created_by_employee_id", referencedTable: "employees", referencedColumn: "id", reason: "dangling_creator_employee_id" },
  { table: "policy_rules", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "compliance_exports", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "compliance_exports", column: "requested_by_employee_id", referencedTable: "employees", referencedColumn: "id", reason: "dangling_requester_employee_id" },
  { table: "legal_holds", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "legal_holds", column: "created_by_employee_id", referencedTable: "employees", referencedColumn: "id", reason: "dangling_creator_employee_id" },
  { table: "retention_freezes", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
  { table: "retention_freezes", column: "created_by_employee_id", referencedTable: "employees", referencedColumn: "id", reason: "dangling_creator_employee_id" },
  { table: "audit_events", column: "org_id", referencedTable: "organizations", referencedColumn: "id", reason: "dangling_org_id" },
];

export class MigrationService {
  private readonly audit: AuditService;
  private readonly operations: OperationsService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.operations = new OperationsService(db);
  }

  createReport(input: CreateMigrationReportInput): string {
    this.assertOrg(input.orgId);
    const normalizedSourcePath = normalizeSourcePath(input.sourceDatabasePath);
    if (!existsSync(normalizedSourcePath)) throw new Error("Source database was not found.");
    const sourceDatabasePath = realpathSync.native(normalizedSourcePath);
    const source = new DatabaseSync(sourceDatabasePath, { readOnly: true });
    try {
      const availableTables = new Set(
        source.prepare("select name from sqlite_master where type = 'table'")
          .all()
          .map((row) => (row as { name: string }).name),
      );
      const tableCounts = Object.fromEntries(
        LEGACY_TABLES
          .filter((table) => availableTables.has(table))
          .map((table) => [table, countRows(source.prepare(`select count(*) as count from ${quoteIdentifier(table)}`))]),
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
      const failures = [
        ...missingTables.map((table) => ({ table, reason: "missing_table", detail: "Required table is absent." })),
        ...validateRelations(source, availableTables),
      ];
      const sourceFingerprint = fingerprintSource({ tableCounts, tableChecksums, idMaps, failures });
      const existingReportId = this.findExistingReport(input.orgId, sourceDatabasePath, sourceFingerprint);
      if (existingReportId) return existingReportId;
      const reportId = createId("mig");
      const now = new Date().toISOString();
      const reportBody: MigrationReportBody = {
        sourceFingerprint,
        tableCounts,
        tableChecksums,
        idMaps,
        missingTables,
        failures,
        rollbackPack: {
          sourceDatabasePath,
          capturedAt: now,
          restoreStrategy: "legacy_snapshot_restore",
          sourceFingerprint,
          tableChecksums,
          idMaps,
        },
      };
      this.db.prepare(`
        insert into migration_reports(id, org_id, source_ref, report_json, created_at)
        values (?, ?, ?, ?, ?)
      `).run(reportId, input.orgId, sourceDatabasePath, JSON.stringify(reportBody), now);
      this.audit.record({
        orgId: input.orgId,
        entityType: "migration_report",
        entityId: reportId,
        actorType: "system",
        actorId: null,
        action: "created",
        payload: { sourceRef: sourceDatabasePath, tableCount: Object.keys(tableCounts).length, sourceFingerprint },
      });
      this.operations.recordSignal({
        orgId: input.orgId,
        signalKey: SLO_SIGNAL_KEY.MIGRATION_VALIDATION_SUCCESS,
        source: "migration_validation",
        success: failures.length === 0,
        durationMs: null,
        detail: { reportId, sourceFingerprint, failureCount: failures.length },
      });
      return reportId;
    } finally {
      source.close();
    }
  }

  private assertOrg(orgId: string): void {
    const org = this.db.prepare("select id from organizations where id = ?").get(orgId);
    if (!org) throw new Error("Organization was not found.");
  }

  private findExistingReport(orgId: string, sourceRef: string, sourceFingerprint: string): string | null {
    const rows = this.db.prepare(`
      select id, report_json from migration_reports
      where org_id = ? and source_ref = ?
      order by created_at desc
    `).all(orgId, sourceRef) as Array<{ id: string; report_json: string }>;
    for (const row of rows) {
      const parsed = parseExistingReport(row.report_json);
      if (parsed.sourceFingerprint === sourceFingerprint) return row.id;
    }
    return null;
  }
}

function normalizeSourcePath(sourceDatabasePath: string): string {
  const trimmed = sourceDatabasePath.trim();
  if (!trimmed) throw new Error("Source database path is required.");
  return resolve(trimmed);
}

function countRows(statement: StatementSync): number {
  return (statement.get() as { count: number }).count;
}

function tableChecksum(source: DatabaseSync, table: string): string {
  const hash = createHash("sha256");
  const rows = source.prepare(`select * from ${quoteIdentifier(table)} order by ${orderingColumn(source, table)}`).all();
  for (const row of rows) hash.update(JSON.stringify(row));
  return hash.digest("hex");
}

function tableIds(source: DatabaseSync, table: string): string[] {
  if (!hasColumn(source, table, "id")) return [];
  return source.prepare(`select id from ${quoteIdentifier(table)} order by id`).all().map((row) => String((row as { id: unknown }).id));
}

function validateRelations(source: DatabaseSync, availableTables: Set<string>): MigrationFailure[] {
  const failures: MigrationFailure[] = [];
  for (const check of RELATION_CHECKS) {
    if (!availableTables.has(check.table) || !availableTables.has(check.referencedTable)) continue;
    if (!hasColumn(source, check.table, check.column)) {
      failures.push({ table: check.table, reason: "missing_column", detail: check.column });
      continue;
    }
    if (!hasColumn(source, check.referencedTable, check.referencedColumn)) {
      failures.push({ table: check.referencedTable, reason: "missing_column", detail: check.referencedColumn });
      continue;
    }
    failures.push(...danglingReferences(source, check));
  }
  return failures;
}

function danglingReferences(source: DatabaseSync, check: RelationCheck): MigrationFailure[] {
  const table = quoteIdentifier(check.table);
  const referencedTable = quoteIdentifier(check.referencedTable);
  const column = quoteIdentifier(check.column);
  const referencedColumn = quoteIdentifier(check.referencedColumn);
  const recordKey = recordKeyExpression(source, check.table);
  const rows = source.prepare(`
    select ${recordKey} as record_id, child.${column} as missing_ref
    from ${table} child
    left join ${referencedTable} parent on child.${column} = parent.${referencedColumn}
    where child.${column} is not null and parent.${referencedColumn} is null
    order by record_id
  `).all() as Array<{ record_id: unknown; missing_ref: unknown }>;
  return rows.map((row) => ({
    table: check.table,
    reason: check.reason,
    detail: `${String(row.record_id)} -> ${String(row.missing_ref)}`,
  }));
}

function hasColumn(source: DatabaseSync, table: string, columnName: string): boolean {
  const columns = source.prepare(`pragma table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function orderingColumn(source: DatabaseSync, table: string): string {
  if (hasColumn(source, table, "id")) return quoteIdentifier("id");
  return "rowid";
}

function recordKeyExpression(source: DatabaseSync, table: string): string {
  if (hasColumn(source, table, "id")) return `child.${quoteIdentifier("id")}`;
  return "child.rowid";
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function fingerprintSource(body: Omit<MigrationReportBody, "sourceFingerprint" | "missingTables" | "rollbackPack">): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function parseExistingReport(reportJson: string): { sourceFingerprint?: string } {
  const parsed = JSON.parse(reportJson) as unknown;
  if (!isRecord(parsed)) throw new Error("Existing migration report is invalid.");
  const fingerprint = parsed.sourceFingerprint;
  if (fingerprint !== undefined && typeof fingerprint !== "string") throw new Error("Existing migration report is invalid.");
  return { sourceFingerprint: fingerprint };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
