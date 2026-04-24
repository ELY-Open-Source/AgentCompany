import type { DatabaseSync } from "node:sqlite";
import { APPROVAL_POLICY_SEED } from "../../approval-policy-definitions";
import { nowIso, tableExists } from "./types";

export const APPROVAL_POLICY_SCHEMA_VERSION = 58;
export const APPROVAL_POLICY_SCHEMA_NAME = "approval_policy_table";

export function migrateApprovalPoliciesV58(db: DatabaseSync): void {
  installApprovalPoliciesTable(db);
  seedApprovalPolicies(db);
  db
    .prepare("insert or replace into schema_migrations (version, name, applied_at) values (?, ?, ?)")
    .run(APPROVAL_POLICY_SCHEMA_VERSION, APPROVAL_POLICY_SCHEMA_NAME, nowIso());
  assertApprovalPoliciesV58(db);
}

export function assertApprovalPoliciesV58(db: DatabaseSync): void {
  if (!tableExists(db, "approval_policies")) {
    throw new Error("Schema v58 drift: approval_policies table is missing.");
  }

  const columns = db
    .prepare("pragma table_info(approval_policies)")
    .all()
    .map((row) => row as { name: string; type: string; notnull: number; pk: number });
  const actualColumns = columns.map((column) => [
    column.name,
    column.type.toUpperCase(),
    column.notnull,
    column.pk,
  ]);
  const expectedColumns = [
    ["approval_type", "TEXT", 0, 1],
    ["scope_type", "TEXT", 1, 0],
    ["blocks_execution", "INTEGER", 1, 0],
    ["required_mode", "TEXT", 1, 0],
    ["auto_approvable", "INTEGER", 1, 0],
    ["created_at", "TEXT", 1, 0],
    ["updated_at", "TEXT", 1, 0],
  ];
  if (JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns)) {
    throw new Error("Schema v58 drift: approval_policies columns do not match the canonical schema.");
  }

  const rows = db
    .prepare(
      "select approval_type as approvalType, scope_type as scopeType, blocks_execution as blocksExecution, required_mode as requiredMode, auto_approvable as autoApprovable from approval_policies order by approval_type",
    )
    .all() as Array<{
      approvalType: string;
      scopeType: string;
      blocksExecution: number;
      requiredMode: string;
      autoApprovable: number;
    }>;
  const actual = rows.map((row) => ({
    approvalType: row.approvalType,
    scopeType: row.scopeType,
    blocksExecution: row.blocksExecution,
    requiredMode: row.requiredMode,
    autoApprovable: row.autoApprovable,
  }));
  const expected = [...APPROVAL_POLICY_SEED]
    .sort((a, b) => a.approvalType.localeCompare(b.approvalType))
    .map((policy) => ({
      approvalType: policy.approvalType,
      scopeType: policy.scopeType,
      blocksExecution: policy.blocksExecution ? 1 : 0,
      requiredMode: policy.requiredMode,
      autoApprovable: policy.autoApprovable ? 1 : 0,
    }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Schema v58 drift: approval_policies seed rows do not match the canonical policy.");
  }
}

function installApprovalPoliciesTable(db: DatabaseSync): void {
  db.exec(`
    create table if not exists approval_policies (
      approval_type text primary key,
      scope_type text not null check (scope_type in ('requester_or_task', 'related_agent')),
      blocks_execution integer not null check (blocks_execution in (0, 1)),
      required_mode text not null check (required_mode in ('any', 'ai_ceo', 'ai_cofounder')),
      auto_approvable integer not null check (auto_approvable in (0, 1)),
      created_at text not null,
      updated_at text not null
    );
  `);
}

function seedApprovalPolicies(db: DatabaseSync): void {
  const ts = nowIso();
  const stmt = db.prepare(
    `insert or replace into approval_policies (
      approval_type, scope_type, blocks_execution, required_mode, auto_approvable, created_at, updated_at
    ) values (?, ?, ?, ?, ?, coalesce((select created_at from approval_policies where approval_type = ?), ?), ?)`,
  );
  for (const policy of APPROVAL_POLICY_SEED) {
    stmt.run(
      policy.approvalType,
      policy.scopeType,
      policy.blocksExecution ? 1 : 0,
      policy.requiredMode,
      policy.autoApprovable ? 1 : 0,
      policy.approvalType,
      ts,
      ts,
    );
  }
}
