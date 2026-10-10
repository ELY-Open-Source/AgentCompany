import type { DatabaseSync } from "node:sqlite";
import type { WorkLanguage } from "../../shared/domain";

/** The language agents work in on a task: the task's own, else its company's; the app's display language plays no part. */
export function taskWorkLanguage(db: DatabaseSync, orgId: string, taskId: string): WorkLanguage {
  const row = db.prepare(`
    select coalesce(t.work_language, o.work_language) as language
    from tasks t join organizations o on o.id = t.org_id
    where t.id = ? and t.org_id = ?
  `).get(taskId, orgId) as { language: WorkLanguage } | undefined;
  if (!row) throw new Error("Task was not found.");
  return row.language;
}

/** The app's display language; agents chat in it. */
export function appLanguage(db: DatabaseSync): WorkLanguage {
  const row = db.prepare("select language from app_state where id = 1").get() as { language: WorkLanguage } | undefined;
  return row?.language ?? "en";
}
