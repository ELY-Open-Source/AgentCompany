import type { DatabaseSync } from "node:sqlite";
import type { OnboardingDraft } from "../../shared/commands";

/** Keeps the unfinished wizard so a restart resumes it; null discards it. The draft type has no key field, so no key is stored. */
export function saveOnboardingDraft(db: DatabaseSync, draft: OnboardingDraft | null): void {
  db.prepare(`
    insert into app_state(id, onboarding_draft_json, updated_at) values (1, ?, ?)
    on conflict(id) do update set onboarding_draft_json = excluded.onboarding_draft_json, updated_at = excluded.updated_at
  `).run(draft ? JSON.stringify(draft) : null, new Date().toISOString());
}

export function loadOnboardingDraft(db: DatabaseSync): OnboardingDraft | null {
  const row = db.prepare("select onboarding_draft_json from app_state where id = 1").get() as { onboarding_draft_json: string | null } | undefined;
  return row?.onboarding_draft_json ? JSON.parse(row.onboarding_draft_json) as OnboardingDraft : null;
}

/** Marks the company's setup (the steps after it was created) finished; until then the wizard reopens on it. */
export function completeSetup(db: DatabaseSync, orgId: string): void {
  const result = db.prepare("update organizations set setup_completed_at = coalesce(setup_completed_at, ?) where id = ?").run(new Date().toISOString(), orgId);
  if (result.changes === 0) throw new Error("Organization was not found.");
  console.info(`[onboarding] ${orgId} finished setup`);
}
