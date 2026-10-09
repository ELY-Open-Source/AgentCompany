import type { DatabaseSync } from "node:sqlite";

export function loadViewState(db: DatabaseSync): Record<string, unknown> {
  const row = db.prepare("select view_state_json from app_state where id = 1").get() as { view_state_json: string | null } | undefined;
  return row?.view_state_json ? JSON.parse(row.view_state_json) as Record<string, unknown> : {};
}

/** Remembers one piece of where the operator was; null forgets it. */
export function saveViewState(db: DatabaseSync, key: string, value: unknown): void {
  const path = `$.${JSON.stringify(key)}`;
  db.prepare(`
    insert into app_state(id, view_state_json, updated_at) values (1, json_object(), ?)
    on conflict(id) do nothing
  `).run(new Date().toISOString());
  if (value === null) {
    db.prepare("update app_state set view_state_json = json_remove(coalesce(view_state_json, json_object()), ?) where id = 1").run(path);
    return;
  }
  db.prepare("update app_state set view_state_json = json_set(coalesce(view_state_json, json_object()), ?, json(?)) where id = 1").run(path, JSON.stringify(value));
}
