import type { DatabaseSync } from "node:sqlite";

/** The global handbrake: while paused, no run is queued or claimed (one in flight finishes); it survives restarts. */
export function setAutonomousPaused(db: DatabaseSync, paused: boolean): void {
  db.prepare(`
    insert into app_state(id, active_org_id, autorun_paused, updated_at)
    values (1, null, ?, ?)
    on conflict(id) do update set autorun_paused = excluded.autorun_paused, updated_at = excluded.updated_at
  `).run(paused ? 1 : 0, new Date().toISOString());
}

/** The app-wide theme and language, kept for every company. */
export function updateUiPreferences(db: DatabaseSync, input: { theme?: "system" | "light" | "dark"; language?: "en" | "zh" }): void {
  const current = db.prepare("select theme, language from app_state where id = 1")
    .get() as { theme: string; language: string } | undefined;
  const theme = input.theme ?? current?.theme ?? "system";
  const language = input.language ?? current?.language ?? "en";
  db.prepare(`
    insert into app_state(id, active_org_id, theme, language, updated_at)
    values (1, null, ?, ?, ?)
    on conflict(id) do update set theme = excluded.theme, language = excluded.language, updated_at = excluded.updated_at
  `).run(theme, language, new Date().toISOString());
}
