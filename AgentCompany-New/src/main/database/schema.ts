import type { DatabaseSync } from "node:sqlite";
import { initialEnterpriseSchema } from "./migrations/001-initial";
import { collaborationProviderPolicySchema } from "./migrations/002-collaboration";
import { onboardingExecutionSchema } from "./migrations/003-onboarding";
import { filesPinnedAndScheduledPosts } from "./migrations/004-files-posts";
import { chatReadState } from "./migrations/005-chat-read-state";
import { appStateSchema } from "./migrations/006-app-state";
import { skillHardeningSchema } from "./migrations/007-skill-hardening";
import { providerHealthSchema } from "./migrations/008-provider-health";
import { socialGovernanceSchema } from "./migrations/009-social-governance";
import { fileHandoffSecuritySchema } from "./migrations/010-file-handoff-security";
import { boardInterventionSchema } from "./migrations/011-board-interventions";
import { complianceControlsSchema } from "./migrations/012-compliance-controls";
import { searchDocumentsSchema } from "./migrations/013-search-documents";
import { providerPolicyUsageSchema } from "./migrations/014-provider-policy-usage";
import { identityAccessSchema } from "./migrations/015-identity-access";
import { orgGovernanceSchema } from "./migrations/016-org-governance";
import { operationsControlsSchema } from "./migrations/017-operations-controls";
import { sdlcControlsSchema } from "./migrations/018-sdlc-controls";
import { auditReplaySchema } from "./migrations/019-audit-replay";
import { rollbackSnapshotsSchema } from "./migrations/020-rollback-snapshots";
import { providerAuthBrokerSchema } from "./migrations/021-provider-auth-broker";
import { providerRateLimitObservationSchema } from "./migrations/022-provider-rate-limit-observations";
import { providerRequestRuntimeSchema } from "./migrations/023-provider-request-runtime";
import { taskRunProviderRequestSchema } from "./migrations/024-task-run-provider-request";
import { chatMessageDeliverySchema } from "./migrations/025-chat-message-delivery";
import { browserPlatformGovernanceSchema } from "./migrations/026-browser-platform-governance";
import { socialAuditRecordsSchema } from "./migrations/027-social-audit-records";
import { migrationCutoverJournalSchema } from "./migrations/028-migration-cutover-journal";
import { fileHandoffRecordsSchema } from "./migrations/029-file-handoff-records";
import { approvalSourceRefsSchema } from "./migrations/030-approval-source-refs";
import { providerRequestWorkspaceSchema } from "./migrations/031-provider-request-workspace";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: 1, name: "initial_enterprise_schema", sql: initialEnterpriseSchema },
  { version: 2, name: "collaboration_provider_policy_schema", sql: collaborationProviderPolicySchema },
  { version: 3, name: "onboarding_execution_schema", sql: onboardingExecutionSchema },
  { version: 4, name: "files_pinned_and_scheduled_posts", sql: filesPinnedAndScheduledPosts },
  { version: 5, name: "chat_read_state", sql: chatReadState },
  { version: 6, name: "app_state", sql: appStateSchema },
  { version: 7, name: "skill_hardening", sql: skillHardeningSchema },
  { version: 8, name: "provider_health", sql: providerHealthSchema },
  { version: 9, name: "social_governance", sql: socialGovernanceSchema },
  { version: 10, name: "file_handoff_security", sql: fileHandoffSecuritySchema },
  { version: 11, name: "board_interventions", sql: boardInterventionSchema },
  { version: 12, name: "compliance_controls", sql: complianceControlsSchema },
  { version: 13, name: "search_documents", sql: searchDocumentsSchema },
  { version: 14, name: "provider_policy_usage", sql: providerPolicyUsageSchema },
  { version: 15, name: "identity_access", sql: identityAccessSchema },
  { version: 16, name: "org_governance", sql: orgGovernanceSchema },
  { version: 17, name: "operations_controls", sql: operationsControlsSchema },
  { version: 18, name: "sdlc_controls", sql: sdlcControlsSchema },
  { version: 19, name: "audit_replay", sql: auditReplaySchema },
  { version: 20, name: "rollback_snapshots", sql: rollbackSnapshotsSchema },
  { version: 21, name: "provider_auth_broker", sql: providerAuthBrokerSchema },
  { version: 22, name: "provider_rate_limit_observations", sql: providerRateLimitObservationSchema },
  { version: 23, name: "provider_request_runtime", sql: providerRequestRuntimeSchema },
  { version: 24, name: "task_run_provider_request", sql: taskRunProviderRequestSchema },
  { version: 25, name: "chat_message_delivery", sql: chatMessageDeliverySchema },
  { version: 26, name: "browser_platform_governance", sql: browserPlatformGovernanceSchema },
  { version: 27, name: "social_audit_records", sql: socialAuditRecordsSchema },
  { version: 28, name: "migration_cutover_journal", sql: migrationCutoverJournalSchema },
  { version: 29, name: "file_handoff_records", sql: fileHandoffRecordsSchema },
  { version: 30, name: "approval_source_refs", sql: approvalSourceRefsSchema },
  { version: 31, name: "provider_request_workspace", sql: providerRequestWorkspaceSchema },
];

const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function installSchema(db: DatabaseSync): void {
  db.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null,
      applied_at text not null
    );
  `);

  const row = db.prepare("select coalesce(max(version), 0) as version from schema_migrations").get() as { version: number };
  let currentVersion = row.version;
  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(`Database schema ${currentVersion} is newer than supported schema ${SCHEMA_VERSION}.`);
  }
  backfillMigrationLedger(db, currentVersion);

  for (const migration of MIGRATIONS) {
    if (currentVersion >= migration.version) continue;
    applyMigration(db, migration);
    currentVersion = migration.version;
  }
}

function applyMigration(db: DatabaseSync, migration: Migration): void {
  db.exec("begin immediate");
  try {
    db.exec(migration.sql);
    recordMigration(db, migration);
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

function backfillMigrationLedger(db: DatabaseSync, currentVersion: number): void {
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) return;
    recordMigration(db, migration);
  }
}

function recordMigration(db: DatabaseSync, migration: Migration): void {
  db.prepare("insert or ignore into schema_migrations(version, name, applied_at) values (?, ?, datetime('now'))")
    .run(migration.version, migration.name);
}
