import { chmodSync, cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { copyFile, cp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync, backup as backupDatabase } from "node:sqlite";
import log from "electron-log/main.js";

function readSchemaVersion(db: DatabaseSync): number {
  const row = db
    .prepare("select coalesce(max(version), 0) as v from schema_migrations")
    .get() as { v: number } | undefined;
  return row?.v ?? 0;
}

function readGitSha(): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
      cwd: process.cwd(),
      timeout: 1000,
    });
    const sha = out.toString("utf8").trim();
    return sha.length === 40 ? sha : null;
  } catch {
    return null;
  }
}

function timestampSegment(): string {
  // Filesystem-safe variant of ISO 8601 (YYYYMMDD-HHmmss-SSS).
  const now = new Date();
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}-` +
    `${pad(now.getUTCMilliseconds(), 3)}`
  );
}

async function copyIfExists(source: string, destination: string) {
  if (!existsSync(source)) {
    return;
  }
  await copyFile(source, destination);
}

export function buildBackupMethods(
  deps: {
    getDb: () => DatabaseSync;
    setDb: (db: DatabaseSync) => void;
    openConnection: () => DatabaseSync;
    init: () => void;
    close: () => void;
    profileDir: string;
    dbPath: string;
    logsDir: string;
    artifactsDir: string;
    backupsDir: string;
    appVersion: string;
  },
) {
  return {
    /**
     * Take a synchronous snapshot of the profile before a destructive or
     * risky operation (currently: pre-migration). Named so the operator
     * can tell snapshots apart by reason and target schema version.
     *
     * Uses `VACUUM INTO` + `cpSync` rather than the async `exportBackup`
     * path so the caller — `runMigrations`, which is synchronous — can
     * block on the backup without any async plumbing. The returned path
     * is absolute so a failed migration can surface the recovery point
     * in logs verbatim.
     *
     * Failure modes are reported by throwing. There is no fallback: if
     * we cannot take a snapshot we must not touch the schema.
     */
    createAutomaticBackup(reason: string): string {
      if (!reason || reason.includes("/") || reason.includes("\\")) {
        throw new Error(`createAutomaticBackup: invalid reason "${reason}"`);
      }
      const db = deps.getDb();
      const schemaVersion = readSchemaVersion(db);
      const segment = `${reason}-v${schemaVersion}-${timestampSegment()}`;
      const targetDir = join(deps.backupsDir, segment);
      mkdirSync(deps.backupsDir, { recursive: true });
      mkdirSync(targetDir, { recursive: true });

      // VACUUM INTO takes a single consistent snapshot of the live DB
      // while the connection is held open — no WAL checkpoint dance, no
      // torn writes, works on sqlite3 ≥ 3.27. The destination must not
      // exist; `mkdirSync` above only created the parent directory.
      const dbTarget = join(targetDir, "profile.sqlite").replace(/'/g, "''");
      db.exec(`VACUUM INTO '${dbTarget}'`);

      // Side-car files (logs + artifacts) ride along so operators
      // restoring from this snapshot see the same run history the
      // migration saw. `cpSync` is recursive and force-overwrites.
      if (existsSync(deps.logsDir)) {
        cpSync(deps.logsDir, join(targetDir, "logs"), { recursive: true, force: true });
      }
      if (existsSync(deps.artifactsDir)) {
        cpSync(deps.artifactsDir, join(targetDir, "artifacts"), { recursive: true, force: true });
      }

      const manifest = {
        reason,
        schemaVersion,
        appVersion: deps.appVersion,
        createdAt: new Date().toISOString(),
        gitSha: readGitSha(),
      };
      writeFileSync(
        join(targetDir, "backup-manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { encoding: "utf8" },
      );
      log.info(`[database/backup] automatic snapshot "${reason}" written to ${targetDir}`);
      return targetDir;
    },

    exportBackup(targetDir: string) {
      mkdirSync(targetDir, { recursive: true });
      deps.getDb().exec("PRAGMA wal_checkpoint(TRUNCATE);");
      const copyJobs = [
        backupDatabase(deps.getDb(), join(targetDir, "profile.sqlite")),
        cp(deps.logsDir, join(targetDir, "logs"), { recursive: true, force: true }),
        cp(deps.artifactsDir, join(targetDir, "artifacts"), { recursive: true, force: true }),
        copyIfExists(`${deps.dbPath}-wal`, join(targetDir, "profile.sqlite-wal")),
        copyIfExists(`${deps.dbPath}-shm`, join(targetDir, "profile.sqlite-shm")),
      ];
      return Promise.all(copyJobs);
    },

    async restoreFromBackup(sourceDir: string) {
      const sourceDbPath = join(sourceDir, "profile.sqlite");
      if (!existsSync(sourceDbPath)) {
        throw new Error("Backup directory is missing profile.sqlite.");
      }

      // Validate
      const currentSchemaVersion =
        (deps.getDb()
          .prepare("select coalesce(max(version), 0) as v from schema_migrations")
          .get() as { v: number } | undefined)?.v ?? 0;
      const validationDb = new DatabaseSync(sourceDbPath);
      try {
        const requiredTables = ["settings", "companies", "connectors"] as const;
        for (const table of requiredTables) {
          const row = validationDb
            .prepare("select name from sqlite_master where type = 'table' and name = ?")
            .get(table) as { name: string } | undefined;
          if (!row) {
            throw new Error(`Backup is missing the required table "${table}".`);
          }
        }
        const hasMigrationsTable = validationDb
          .prepare("select name from sqlite_master where type = 'table' and name = 'schema_migrations'")
          .get() as { name: string } | undefined;
        if (!hasMigrationsTable) {
          throw new Error(
            `Backup is missing schema_migrations. Expected schema version ${currentSchemaVersion}.`,
          );
        }
        const backupVersion =
          (validationDb
            .prepare("select coalesce(max(version), 0) as v from schema_migrations")
            .get() as { v: number } | undefined)?.v ?? 0;
        if (backupVersion < currentSchemaVersion) {
          throw new Error(
            `Backup schema version ${backupVersion} is older than current ${currentSchemaVersion}. Restore would lose migrations.`,
          );
        }
      } finally {
        validationDb.close();
      }

      const recoveryDir = join(deps.backupsDir, `pre-restore-${Date.now()}`);
      mkdirSync(recoveryDir, { recursive: true });
      deps.getDb().exec("PRAGMA wal_checkpoint(TRUNCATE);");
      await Promise.all([
        backupDatabase(deps.getDb(), join(recoveryDir, "profile.sqlite")),
        cp(deps.logsDir, join(recoveryDir, "logs"), { recursive: true, force: true }),
        cp(deps.artifactsDir, join(recoveryDir, "artifacts"), { recursive: true, force: true }),
        copyIfExists(join(deps.profileDir, "vault.key"), join(recoveryDir, "vault.key")),
        copyIfExists(join(deps.profileDir, "agent-api-signing.key"), join(recoveryDir, "agent-api-signing.key")),
        copyIfExists(`${deps.dbPath}-wal`, join(recoveryDir, "profile.sqlite-wal")),
        copyIfExists(`${deps.dbPath}-shm`, join(recoveryDir, "profile.sqlite-shm")),
      ]);

      deps.close();
      try {
        await applyBackup(sourceDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await applyBackup(recoveryDir);
        } catch (recoveryError) {
          const recoveryMessage =
            recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
          try {
            deps.setDb(deps.openConnection());
            deps.init();
          } catch (reopenError) {
            log.error(`[database/backup] Reopen failed after restore/recovery failure:`, reopenError instanceof Error ? reopenError.message : String(reopenError));
          }
          throw new Error(
            `Restore failed: ${message}. Recovery also failed: ${recoveryMessage}. Previous profile is at ${recoveryDir}.`,
          );
        }
        throw new Error(`Restore failed. Previous profile was recovered from ${recoveryDir}. ${message}`);
      }
    },
  };

  async function applyBackup(sourceDir: string) {
    await rm(deps.dbPath, { force: true });
    await rm(`${deps.dbPath}-wal`, { force: true });
    await rm(`${deps.dbPath}-shm`, { force: true });

    await copyFile(join(sourceDir, "profile.sqlite"), deps.dbPath);
    await copyIfExists(join(sourceDir, "profile.sqlite-wal"), `${deps.dbPath}-wal`);
    await copyIfExists(join(sourceDir, "profile.sqlite-shm"), `${deps.dbPath}-shm`);

    await rm(deps.logsDir, { recursive: true, force: true });
    await rm(deps.artifactsDir, { recursive: true, force: true });
    mkdirSync(deps.logsDir, { recursive: true });
    mkdirSync(deps.artifactsDir, { recursive: true });

    if (existsSync(join(sourceDir, "logs"))) {
      await cp(join(sourceDir, "logs"), deps.logsDir, { recursive: true, force: true });
    }
    if (existsSync(join(sourceDir, "artifacts"))) {
      await cp(join(sourceDir, "artifacts"), deps.artifactsDir, { recursive: true, force: true });
    }
    await copyIfExists(join(sourceDir, "vault.key"), join(deps.profileDir, "vault.key"));
    await copyIfExists(join(sourceDir, "agent-api-signing.key"), join(deps.profileDir, "agent-api-signing.key"));
    if (existsSync(join(deps.profileDir, "vault.key"))) {
      chmodSync(join(deps.profileDir, "vault.key"), 0o600);
    }
    if (existsSync(join(deps.profileDir, "agent-api-signing.key"))) {
      chmodSync(join(deps.profileDir, "agent-api-signing.key"), 0o600);
    }

    deps.setDb(deps.openConnection());
    deps.init();
  }
}
