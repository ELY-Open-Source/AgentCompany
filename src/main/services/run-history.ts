import type { DatabaseSync } from "node:sqlite";
import type { RunCursor, RunHistoryPage, TaskRunRecord } from "../../shared/domain";
import { camel } from "./snapshot-service";

/** Which older runs to return: the next page before the cursor, or every run from a position (which survives its run's deletion) up to it. */
export type RunHistoryScope = { limit: number } | { from: RunCursor };

/** Runs before a loaded one (or the newest when none is loaded), oldest first, in time then insertion order, and whether older ones exist. */
export function runHistory(db: DatabaseSync, orgId: string, beforeRunId: string | null, scope: RunHistoryScope): RunHistoryPage {
  const conditions = ["org_id = ?"];
  const params: Array<string | number> = [orgId];
  let boundary: RunCursor | null = null;
  if (beforeRunId !== null) {
    const before = db.prepare("select created_at, rowid from task_runs where id = ? and org_id = ?").get(beforeRunId, orgId) as { created_at: string; rowid: number } | undefined;
    if (!before) throw new Error("The oldest loaded run was not found.");
    conditions.push("(created_at, rowid) < (?, ?)");
    params.push(before.created_at, before.rowid);
    boundary = { createdAt: before.created_at, seq: before.rowid };
  }
  if ("from" in scope) {
    conditions.push("(created_at, rowid) >= (?, ?)");
    params.push(scope.from.createdAt, scope.from.seq);
  }
  const limit = "limit" in scope ? scope.limit : -1;
  const rows = db.prepare(`select *, rowid as seq from task_runs where ${conditions.join(" and ")} order by created_at desc, rowid desc limit ?`)
    .all(...params, limit === -1 ? -1 : limit + 1) as Array<Record<string, unknown>>;
  const page = (limit === -1 ? rows : rows.slice(0, limit)).reverse();
  const first = page[0];
  const oldest = first ? { createdAt: first.created_at as string, seq: first.seq as number } : null;
  // A range is measured from its pinned position, which holds even when the runs at it were deleted.
  const hasMore = "limit" in scope ? rows.length > limit : db.prepare(`
    select 1 from task_runs where org_id = ? and (created_at, rowid) < (?, ?) limit 1
  `).get(orgId, scope.from.createdAt, scope.from.seq) !== undefined;
  return { runs: page.map(({ seq: _seq, ...row }) => camel(row) as unknown as TaskRunRecord), hasMore, oldest, boundary };
}
