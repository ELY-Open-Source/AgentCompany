import type { DatabaseSync } from "node:sqlite";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** A running write task whose directory overlaps this task's, or null. */
export function runningWorkspaceWriter(db: DatabaseSync, taskId: string): { title: string } | null {
  const task = db.prepare(`
    select t.requires_filesystem, w.local_path
    from tasks t left join workspaces w on w.id = t.workspace_id
    where t.id = ?
  `).get(taskId) as { requires_filesystem: number; local_path: string | null } | undefined;
  if (!task) throw new Error(`Task ${taskId} was not found.`);
  if (task.requires_filesystem !== 1 || !task.local_path) return null;
  const mine = normalizeDirectory(task.local_path);
  const writers = db.prepare(`
    select t.title, w.local_path
    from task_runs r
    join tasks t on t.id = r.task_id
    join workspaces w on w.id = t.workspace_id
    where r.state = 'running' and t.requires_filesystem = 1
  `).all() as Array<{ title: string; local_path: string }>;
  for (const writer of writers) {
    const other = normalizeDirectory(writer.local_path);
    if (mine === other || mine.startsWith(`${other}/`) || other.startsWith(`${mine}/`)) return { title: writer.title };
  }
  return null;
}

function normalizeDirectory(localPath: string): string {
  let existing = resolve(localPath);
  const missing: string[] = [];
  while (!existsSync(existing) && dirname(existing) !== existing) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  const real = existsSync(existing) ? realpathSync.native(existing) : existing;
  const path = join(real, ...missing).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? path.toLowerCase() : path;
}
