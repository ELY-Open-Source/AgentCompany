import type { DatabaseSync } from "node:sqlite";
import { initialEnterpriseSchema } from "./migrations/001-initial";
import { collaborationProviderPolicySchema } from "./migrations/002-collaboration";
import { onboardingExecutionSchema } from "./migrations/003-onboarding";
import { filesPinnedAndScheduledPosts } from "./migrations/004-files-posts";
import { chatReadState } from "./migrations/005-chat-read-state";
import { appStateSchema } from "./migrations/006-app-state";
import { skillHardeningSchema } from "./migrations/007-skill-hardening";
import { providerHealthSchema } from "./migrations/008-provider-health";

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: initialEnterpriseSchema },
  { version: 2, sql: collaborationProviderPolicySchema },
  { version: 3, sql: onboardingExecutionSchema },
  { version: 4, sql: filesPinnedAndScheduledPosts },
  { version: 5, sql: chatReadState },
  { version: 6, sql: appStateSchema },
  { version: 7, sql: skillHardeningSchema },
  { version: 8, sql: providerHealthSchema },
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

  for (const migration of MIGRATIONS) {
    if (currentVersion >= migration.version) continue;
    db.exec(migration.sql);
    currentVersion = migration.version;
  }
}
