import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, tableExists } from "./types";

/**
 * Per-task filesystem lock policy — `tasks.requires_filesystem`.
 *
 * Background: before v52 `resolveWorkspaceWithLockMode` walked a four-
 * step fallback chain (task → agent → project → any company workspace)
 * and unconditionally marked the resolved row `exclusive`. In a
 * multi-agent company every heartbeat collapsed onto the single
 * company workspace row, every run claimed the same exclusive lock,
 * and only one agent ever executed at a time — the "parallel C-suite"
 * promise degraded silently into serial execution.
 *
 * Root cause is a schema one: the per-task shape of the question
 * "does this task actually touch the filesystem?" had no column to
 * live in, so the orchestrator defaulted to yes on everything. v52
 * gives that question its own column.
 *
 * Invariants after this migration:
 *   • Every task row carries `requires_filesystem` ∈ {0, 1}.
 *   • `0` is the safe default — purely cognitive tasks (strategy,
 *     planning, document drafting, financial analysis) never take
 *     a workspace lock and run fully in parallel.
 *   • `1` is opt-in — explicitly signals "this task mutates the
 *     working tree, hold the workspace exclusive for the run".
 *
 * Backfill strategy (conservative — we only set `1` when we have
 * positive evidence of filesystem use):
 *
 *   a) In-flight tasks (`status = 'in_progress'` AND `active_run_id
 *      IS NOT NULL`): these currently hold a lease on a workspace;
 *      changing their flag mid-run would desynchronise the live
 *      dispatcher from the backing row. Mark `1` to preserve the
 *      exclusive semantics already in effect.
 *
 *   b) Actionable tasks (`status IN ('todo','backlog')`) whose
 *      assignee is an engineering-flavoured role: CTO / engineer /
 *      developer / devops / SRE, or department = 'engineering'.
 *      These are the roles that `createCodingTools()` equips; every
 *      other role's task bag is cognitive by default.
 *
 *   c) Everything else (done / cancelled / blocked / in_review
 *      non-engineering / etc.): `0`. Completed or cancelled tasks
 *      will never run again so the column value is advisory;
 *      blocked tasks will re-enter the dispatcher through an update
 *      path that will set the flag explicitly when it matters.
 *
 * Assertion: after backfill, zero NULL rows (the DEFAULT 0 on the
 * ALTER TABLE guarantees this; the assertion is belt-and-braces).
 */

export function createMigrationsV52V52(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 52,
      name: "tasks_requires_filesystem",
      fn: () => {
        if (!tableExists(db, "tasks")) {
          log.info("[migration v52] tasks table missing; nothing to do");
          return;
        }

        // ── 1. Add the column. NOT NULL DEFAULT 0 so existing rows
        //    get a deterministic value at ALTER time — no NULL window
        //    between the ALTER and the backfill UPDATE.
        if (!columnExists(db, "tasks", "requires_filesystem")) {
          db.exec(
            `ALTER TABLE tasks ADD COLUMN requires_filesystem INTEGER NOT NULL DEFAULT 0`,
          );
          log.info("[migration v52] tasks.requires_filesystem column added");
        } else {
          log.info("[migration v52] tasks.requires_filesystem already present; reusing");
        }

        // ── 2. Backfill rule (a): in-flight rows preserve the lease
        //    the dispatcher is already holding. Turning these off
        //    would leave a running lease pointing at a task whose
        //    current policy says "no lease needed".
        const inflightUpdate = db.prepare(
          `UPDATE tasks
              SET requires_filesystem = 1
            WHERE status = 'in_progress'
              AND active_run_id IS NOT NULL`,
        ).run();
        log.info(
          `[migration v52] backfill (a) inflight: ${Number(inflightUpdate.changes)} rows set to 1`,
        );

        // ── 3. Backfill rule (b): actionable tasks for coding roles.
        //    LIKE comparisons are case-insensitive in SQLite by
        //    default (NOCASE collation on text literal compares).
        //    We match both the free-text `agents.role` (where the
        //    UI lets users write "CTO", "Senior Engineer", etc.) and
        //    the structured `agents.department` column where present.
        const codingRoleUpdate = db.prepare(
          `UPDATE tasks
              SET requires_filesystem = 1
            WHERE status IN ('todo', 'backlog')
              AND assignee_agent_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM agents a
                 WHERE a.id = tasks.assignee_agent_id
                   AND (
                        a.role LIKE '%cto%'
                     OR a.role LIKE '%engineer%'
                     OR a.role LIKE '%developer%'
                     OR a.role LIKE '%devops%'
                     OR a.role LIKE '%sre%'
                     OR a.department = 'engineering'
                   )
              )`,
        ).run();
        log.info(
          `[migration v52] backfill (b) coding role actionable: ${Number(codingRoleUpdate.changes)} rows set to 1`,
        );

        // ── 4. Invariant assertion. DEFAULT 0 combined with the two
        //    targeted UPDATEs above means the column is never NULL,
        //    but the assertion makes the post-condition explicit so
        //    a future migration that removes the DEFAULT cannot
        //    silently violate it.
        const nullCountRow = db.prepare(
          `SELECT COUNT(*) AS count FROM tasks WHERE requires_filesystem IS NULL`,
        ).get() as { count: number } | undefined;
        const nullCount = nullCountRow?.count ?? 0;
        if (nullCount > 0) {
          throw new Error(
            `[migration v52] invariant violated: ${nullCount} tasks row(s) have requires_filesystem IS NULL after backfill`,
          );
        }

        // Diagnostic counts — read back the final distribution so the
        // upgrade log carries evidence that backfill matched the
        // expected order of magnitude.
        const totals = db.prepare(
          `SELECT
             SUM(CASE WHEN requires_filesystem = 1 THEN 1 ELSE 0 END) AS fsOn,
             SUM(CASE WHEN requires_filesystem = 0 THEN 1 ELSE 0 END) AS fsOff
           FROM tasks`,
        ).get() as { fsOn: number | null; fsOff: number | null } | undefined;
        log.info(
          `[migration v52] final distribution: requires_filesystem=1 → ${totals?.fsOn ?? 0}, requires_filesystem=0 → ${totals?.fsOff ?? 0}`,
        );
      },
    },
  ];
}
