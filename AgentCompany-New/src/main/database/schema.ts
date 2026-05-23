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
