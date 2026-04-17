import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, tableExists } from "./types";

export function createMigrationsV35V37(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      // Rebuild runs table with task_id NULLABLE. Heartbeat runs (agent
      // wake-ups with no real task) no longer need to synthesize a fake
      // task row; they simply insert a run with task_id = NULL. The old
      // workaround (is_heartbeat flag + acquireHeartbeatTask + cleanup
      // sweeps) becomes dead code in v36.
      //
      // SQLite can't ALTER a column's NOT NULL constraint, so we rebuild:
      //   1. Snapshot row count
      //   2. Discover actual column set via PRAGMA (drift safe)
      //   3. CREATE runs_new with the same columns + task_id nullable
      //   4. Copy every row
      //   5. Assert copied count == snapshot count (abort before DROP
      //      if any row went missing)
      //   6. DROP old, RENAME new
      //   7. Recreate every index on runs
      //
      // FK from run_events(run_id) references runs(id); PRAGMA foreign_keys
      // OFF during the rebuild (we're inside a transaction already, so we
      // toggle the defer_foreign_keys flag instead — SQLite forbids
      // changing foreign_keys mid-transaction).
      version: 35, name: "make_runs_task_id_nullable",
      fn: () => {
        const beforeCount = (db
          .prepare("SELECT COUNT(*) as cnt FROM runs")
          .get() as { cnt: number }).cnt;

        const existingCols = (db
          .prepare("PRAGMA table_info(runs)")
          .all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>);
        if (existingCols.length === 0) {
          throw new Error("runs table is missing; refusing to migrate");
        }
        const colNames = existingCols.map((c) => c.name);

        // Declare the known v34 column set. If the live DB has drift (extra
        // columns we did not declare), preserve those verbatim using the
        // column metadata from PRAGMA.
        const knownCols = new Set([
          "id", "company_id", "task_id", "agent_id", "workspace_id",
          "connector_id", "status", "summary", "error_message", "exit_code",
          "signal", "model", "session_display_id", "cost_usd",
          "unattributed_cost", "started_at", "finished_at", "log_path",
          "created_at", "updated_at", "context_snapshot_json",
          "actor_type", "actor_id",
        ]);
        const driftCols = existingCols.filter((c) => !knownCols.has(c.name));

        // Defer FK checks within this transaction.
        db.exec("PRAGMA defer_foreign_keys = ON");

        // Build CREATE TABLE runs_new. task_id is nullable. Other columns
        // reuse the declared types / constraints. For drift columns we
        // emit a best-effort column definition (type, NULL, default).
        const declaredDdl = [
          "id TEXT PRIMARY KEY",
          "company_id TEXT NOT NULL",
          "task_id TEXT", // NULLABLE (was NOT NULL)
          "agent_id TEXT NOT NULL",
          "workspace_id TEXT",
          "connector_id TEXT NOT NULL",
          "status TEXT NOT NULL",
          "summary TEXT NOT NULL",
          "error_message TEXT",
          "exit_code INTEGER",
          "signal TEXT",
          "model TEXT",
          "session_display_id TEXT",
          "cost_usd REAL",
          "unattributed_cost INTEGER NOT NULL DEFAULT 0",
          "started_at TEXT",
          "finished_at TEXT",
          "log_path TEXT",
          "created_at TEXT NOT NULL",
          "updated_at TEXT NOT NULL",
          "context_snapshot_json TEXT",
          "actor_type TEXT",
          "actor_id TEXT",
        ];
        for (const drift of driftCols) {
          const type = drift.type || "TEXT";
          declaredDdl.push(`${drift.name} ${type}`);
        }

        db.exec(`CREATE TABLE runs_new (${declaredDdl.join(", ")})`);

        // Copy preserving every column present in the old table.
        const copyCols = colNames.join(", ");
        db.exec(`INSERT INTO runs_new (${copyCols}) SELECT ${copyCols} FROM runs`);

        const afterCount = (db
          .prepare("SELECT COUNT(*) as cnt FROM runs_new")
          .get() as { cnt: number }).cnt;
        if (afterCount !== beforeCount) {
          throw new Error(
            `runs copy row count mismatch: before=${beforeCount} after=${afterCount}; aborting before DROP`,
          );
        }

        db.exec("DROP TABLE runs");
        db.exec("ALTER TABLE runs_new RENAME TO runs");

        // Recreate every index on runs.
        db.exec("CREATE INDEX IF NOT EXISTS idx_runs_company ON runs(company_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_runs_company_status ON runs(company_id, status)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_runs_company_created_at ON runs(company_id, created_at DESC)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_runs_agent_created_at ON runs(agent_id, created_at DESC)");

        log.info(`[migration v35] runs table rebuilt with nullable task_id (${afterCount} rows preserved)`);
      },
    },
    {
      // Drop the `tasks.is_heartbeat` column and all synthetic heartbeat
      // task rows. Prerequisite: v35 must have made runs.task_id nullable
      // so we can null-out runs that pointed at heartbeat tasks before
      // deleting those task rows.
      version: 36, name: "drop_tasks_is_heartbeat_and_synthetic_rows",
      fn: () => {
        const hasColumn = columnExists(db, "tasks", "is_heartbeat");
        if (!hasColumn) {
          log.info("[migration v36] tasks.is_heartbeat already absent; skipping");
          return;
        }

        // 1. NULL-out runs that pointed at heartbeat tasks.
        const updated = db
          .prepare(
            "UPDATE runs SET task_id = NULL WHERE task_id IN (SELECT id FROM tasks WHERE is_heartbeat = 1)",
          )
          .run();
        const runsNulledOut = Number(updated.changes);

        // 2. Delete synthetic heartbeat tasks. Cost entries referring to
        //    these tasks remain with their task_id pointing at now-deleted
        //    ids — acceptable, cost_entries.task_id has no FK constraint.
        //    task_comments and approvals attached to these tasks are
        //    already cascaded by the task row delete or would remain
        //    orphaned; heartbeat tasks carry neither in practice.
        const beforeHeartbeatCount = (db
          .prepare("SELECT COUNT(*) as cnt FROM tasks WHERE is_heartbeat = 1")
          .get() as { cnt: number }).cnt;
        db.exec("DELETE FROM tasks WHERE is_heartbeat = 1");

        // 3. Rebuild `tasks` without the is_heartbeat column.
        const beforeTasksCount = (db
          .prepare("SELECT COUNT(*) as cnt FROM tasks")
          .get() as { cnt: number }).cnt;

        const existingCols = (db
          .prepare("PRAGMA table_info(tasks)")
          .all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>);
        const keepCols = existingCols.filter((c) => c.name !== "is_heartbeat");

        db.exec("PRAGMA defer_foreign_keys = ON");

        // Declared v20 + v13 + v38+v39/v20 column set for `tasks`. Drift
        // columns (any column we haven't declared here) are preserved
        // verbatim using PRAGMA metadata — same drift-safe shape as v35.
        const declaredCols = new Map<string, string>([
          ["id", "TEXT PRIMARY KEY"],
          ["company_id", "TEXT NOT NULL"],
          ["project_id", "TEXT"],
          ["goal_id", "TEXT"],
          ["parent_id", "TEXT"],
          ["title", "TEXT NOT NULL"],
          ["description", "TEXT NOT NULL"],
          ["assignee_agent_id", "TEXT"],
          ["workspace_id", "TEXT"],
          ["status", "TEXT NOT NULL"],
          ["priority", "TEXT NOT NULL"],
          ["active_run_id", "TEXT"],
          ["session_json", "TEXT"],
          ["session_display_id", "TEXT"],
          ["cost_usd", "REAL NOT NULL DEFAULT 0"],
          ["created_at", "TEXT NOT NULL"],
          ["updated_at", "TEXT NOT NULL"],
          ["task_type", "TEXT NOT NULL DEFAULT 'general'"],
          ["requires_user_review", "INTEGER NOT NULL DEFAULT 0"],
          ["retry_count", "INTEGER NOT NULL DEFAULT 0"],
          ["last_failure_at", "TEXT"],
          ["checkout_run_id", "TEXT"],
          ["execution_locked_at", "TEXT"],
          ["active_session_id", "TEXT"],
          ["started_at", "TEXT"],
          ["completed_at", "TEXT"],
          ["cancelled_at", "TEXT"],
        ]);

        const ddl = keepCols.map((c) => {
          const declared = declaredCols.get(c.name);
          if (declared) return `${c.name} ${declared}`;
          return `${c.name} ${c.type || "TEXT"}`;
        });

        db.exec(`CREATE TABLE tasks_new (${ddl.join(", ")})`);

        const copyCols = keepCols.map((c) => c.name).join(", ");
        db.exec(`INSERT INTO tasks_new (${copyCols}) SELECT ${copyCols} FROM tasks`);

        const afterTasksCount = (db
          .prepare("SELECT COUNT(*) as cnt FROM tasks_new")
          .get() as { cnt: number }).cnt;
        if (afterTasksCount !== beforeTasksCount) {
          throw new Error(
            `tasks copy row count mismatch: before=${beforeTasksCount} after=${afterTasksCount}; aborting before DROP`,
          );
        }

        db.exec("DROP TABLE tasks");
        db.exec("ALTER TABLE tasks_new RENAME TO tasks");

        // Recreate every index on tasks.
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_agent_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_company_status ON tasks(company_id, status)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_company_created_at ON tasks(company_id, created_at DESC)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_company_updated_at ON tasks(company_id, updated_at DESC)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_company_assignee_status ON tasks(company_id, assignee_agent_id, status)");

        log.info(
          `[migration v36] removed tasks.is_heartbeat; deleted ${beforeHeartbeatCount} synthetic heartbeat task row(s); nulled task_id on ${runsNulledOut} run(s); preserved ${afterTasksCount} task row(s)`,
        );
      },
    },
    {
      // Drop the `markdown` column from company_skills. SKILL.md on disk
      // (profile/skills/{companyId}/{slug}/SKILL.md) is the authoritative
      // source of truth read by pi-coding-agent's loadSkills. The DB column
      // duplicated that content. UI now loads the body live via IPC.
      //
      // SQLite can't DROP COLUMN cleanly pre-3.35 and even the supported path
      // is implemented as an invisible rebuild, so we do an explicit
      // drift-safe rebuild mirroring v35/v36:
      //   1. Snapshot row count
      //   2. PRAGMA table_info to discover the live column set
      //   3. CREATE company_skills_new without `markdown`
      //   4. Copy every kept column
      //   5. Assert copied count matches
      //   6. DROP old, RENAME new, recreate indexes
      //
      // FK from agent_skill_assignments(skill_id) -> company_skills(id) must
      // survive. PRAGMA defer_foreign_keys = ON keeps checks deferred until
      // transaction commit (by which time RENAME has restored the table).
      version: 37, name: "drop_company_skills_markdown",
      fn: () => {
        if (!tableExists(db, "company_skills")) {
          log.info("[migration v37] company_skills table absent; skipping");
          return;
        }
        if (!columnExists(db, "company_skills", "markdown")) {
          log.info("[migration v37] company_skills.markdown already absent; skipping");
          return;
        }

        const beforeCount = (db
          .prepare("SELECT COUNT(*) as cnt FROM company_skills")
          .get() as { cnt: number }).cnt;

        const existingCols = (db
          .prepare("PRAGMA table_info(company_skills)")
          .all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>);
        const keepCols = existingCols.filter((c) => c.name !== "markdown");

        db.exec("PRAGMA defer_foreign_keys = ON");

        // Declared v14 column set (minus markdown). Drift columns preserved
        // verbatim from PRAGMA metadata.
        const declaredCols = new Map<string, string>([
          ["id", "TEXT PRIMARY KEY"],
          ["company_id", "TEXT NOT NULL"],
          ["key", "TEXT NOT NULL"],
          ["slug", "TEXT NOT NULL"],
          ["name", "TEXT NOT NULL"],
          ["description", "TEXT"],
          ["source_type", "TEXT NOT NULL DEFAULT 'local_path'"],
          ["source_locator", "TEXT"],
          ["source_ref", "TEXT"],
          ["trust_level", "TEXT NOT NULL DEFAULT 'markdown_only'"],
          ["compatibility", "TEXT NOT NULL DEFAULT 'compatible'"],
          ["file_inventory", "TEXT NOT NULL DEFAULT '[]'"],
          ["metadata", "TEXT"],
          ["created_at", "TEXT NOT NULL"],
          ["updated_at", "TEXT NOT NULL"],
        ]);

        const ddl = keepCols.map((c) => {
          const declared = declaredCols.get(c.name);
          if (declared) return `${c.name} ${declared}`;
          return `${c.name} ${c.type || "TEXT"}`;
        });

        db.exec(`CREATE TABLE company_skills_new (${ddl.join(", ")})`);

        const copyCols = keepCols.map((c) => c.name).join(", ");
        db.exec(`INSERT INTO company_skills_new (${copyCols}) SELECT ${copyCols} FROM company_skills`);

        const afterCount = (db
          .prepare("SELECT COUNT(*) as cnt FROM company_skills_new")
          .get() as { cnt: number }).cnt;
        if (afterCount !== beforeCount) {
          throw new Error(
            `company_skills copy row count mismatch: before=${beforeCount} after=${afterCount}; aborting before DROP`,
          );
        }

        db.exec("DROP TABLE company_skills");
        db.exec("ALTER TABLE company_skills_new RENAME TO company_skills");

        db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_company_skills_company_key ON company_skills(company_id, key)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_company_skills_company_name ON company_skills(company_id, name)");

        log.info(`[migration v37] dropped company_skills.markdown; preserved ${afterCount} row(s)`);
      },
    },
  ];
}
