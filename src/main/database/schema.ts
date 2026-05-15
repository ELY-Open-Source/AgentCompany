import type { DatabaseSync } from "node:sqlite";
import log from "electron-log/main.js";
import {
  BASELINE_SCHEMA_VERSION,
  assertBaselineSchema,
  installBaselineSchema,
} from "./migrations/baseline-v56";
import {
  markBaselineSchema,
  upgradeLegacyProfileToBaselineV56,
} from "./migrations/legacy-to-v56";
import {
  TASK_LEASE_SCHEMA_VERSION,
  assertTaskLeasesV57,
  migrateTaskLeasesV57,
} from "./migrations/v57-task-leases";
import {
  APPROVAL_POLICY_SCHEMA_VERSION,
  assertApprovalPoliciesV58,
  migrateApprovalPoliciesV58,
} from "./migrations/v58-approval-policies";
import {
  SOCIAL_COMPANY_SCOPE_SCHEMA_VERSION,
  assertSocialCompanyScopeV59,
  migrateSocialCompanyScopeV59,
} from "./migrations/v59-social-company-scope";
import {
  FILESYSTEM_TASK_WORKSPACES_SCHEMA_VERSION,
  assertFilesystemTaskWorkspacesV60,
  migrateFilesystemTaskWorkspacesV60,
} from "./migrations/v60-filesystem-task-workspaces";
import {
  type ReadAll,
  type Transaction,
} from "./migrations/types";

const LATEST_SCHEMA_VERSION = FILESYSTEM_TASK_WORKSPACES_SCHEMA_VERSION;

export function initializeDatabase(
  db: DatabaseSync,
  ra: ReadAll,
  tx: Transaction,
  createAutomaticBackup: (reason: string) => string,
): void {
  db.exec("create table if not exists schema_migrations (version integer primary key, name text not null, applied_at text not null)");

  const currentVersion = currentSchemaVersion(db);
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(`Profile schema version ${currentVersion} is newer than this app schema ${LATEST_SCHEMA_VERSION}.`);
  }

  if (currentVersion === LATEST_SCHEMA_VERSION) {
    tx(() => {
      seedSettings(db);
      assertTaskLeasesV57(db);
      assertApprovalPoliciesV58(db);
      assertSocialCompanyScopeV59(db);
      assertFilesystemTaskWorkspacesV60(db);
    });
    return;
  }

  if (currentVersion === SOCIAL_COMPANY_SCOPE_SCHEMA_VERSION) {
    tx(() => {
      seedSettings(db);
      assertTaskLeasesV57(db);
      assertApprovalPoliciesV58(db);
      assertSocialCompanyScopeV59(db);
      migrateFilesystemTaskWorkspacesV60(db);
    });
    return;
  }

  if (currentVersion === APPROVAL_POLICY_SCHEMA_VERSION) {
    tx(() => {
      seedSettings(db);
      assertTaskLeasesV57(db);
      assertApprovalPoliciesV58(db);
      migrateSocialCompanyScopeV59(db);
      migrateFilesystemTaskWorkspacesV60(db);
    });
    return;
  }

  if (currentVersion === TASK_LEASE_SCHEMA_VERSION) {
    tx(() => {
      seedSettings(db);
      assertTaskLeasesV57(db);
      migrateApprovalPoliciesV58(db);
      migrateSocialCompanyScopeV59(db);
      migrateFilesystemTaskWorkspacesV60(db);
    });
    return;
  }

  if (currentVersion === BASELINE_SCHEMA_VERSION) {
    tx(() => {
      installBaselineSchema(db);
      markBaselineSchema(db);
      seedSettings(db);
      assertBaselineSchema(db);
      migrateTaskLeasesV57(db);
      migrateApprovalPoliciesV58(db);
      migrateSocialCompanyScopeV59(db);
      migrateFilesystemTaskWorkspacesV60(db);
    });
    return;
  }

  if (profileHasApplicationTables(db)) {
    const backupPath = createAutomaticBackup(`pre-migration-v${BASELINE_SCHEMA_VERSION}`);
    log.info(`[schema] pre-migration snapshot for v${BASELINE_SCHEMA_VERSION} at ${backupPath}`);
    withForeignKeysPaused(db, tx, () => {
      upgradeLegacyProfileToBaselineV56({ db, readAll: ra });
      seedSettings(db);
      assertBaselineSchema(db);
      migrateTaskLeasesV57(db);
      migrateApprovalPoliciesV58(db);
      migrateSocialCompanyScopeV59(db);
      migrateFilesystemTaskWorkspacesV60(db);
    });
    return;
  }

  tx(() => {
    installBaselineSchema(db);
    markBaselineSchema(db);
    seedSettings(db);
    assertBaselineSchema(db);
    migrateTaskLeasesV57(db);
    migrateApprovalPoliciesV58(db);
    migrateSocialCompanyScopeV59(db);
    migrateFilesystemTaskWorkspacesV60(db);
  });
}

export function seedSettings(db: DatabaseSync): void {
  const getSetting = (key: string): string | null => {
    const row = db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  };
  const setSetting = (key: string, value: string) => {
    db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  };
  if (!getSetting("theme")) setSetting("theme", "system");
  if (!getSetting("updates_enabled")) setSetting("updates_enabled", "false");
  if (!getSetting("log_retention_days")) setSetting("log_retention_days", "90");
}

function currentSchemaVersion(db: DatabaseSync): number {
  const row = db
    .prepare("select coalesce(max(version), 0) as version from schema_migrations")
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}

function profileHasApplicationTables(db: DatabaseSync): boolean {
  const rows = db
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .all() as Array<{ name: string }>;
  return rows.some((row) => row.name !== "schema_migrations" && row.name !== "settings");
}

function withForeignKeysPaused<T>(db: DatabaseSync, tx: Transaction, op: () => T): T {
  const row = db.prepare("pragma foreign_keys").get() as { foreign_keys: number } | undefined;
  const previous = row?.foreign_keys === 1 ? "ON" : "OFF";
  db.exec("pragma foreign_keys = OFF");
  try {
    return tx(op);
  } finally {
    db.exec(`pragma foreign_keys = ${previous}`);
  }
}
