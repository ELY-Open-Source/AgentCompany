// Onboarding survives a restart: the unfinished wizard (never its key) and whether a created company finished setup; existing companies are done.
export const onboardingProgressSchema = `
  alter table app_state add column onboarding_draft_json text;
  alter table organizations add column setup_completed_at text;
  update organizations set setup_completed_at = created_at;

  insert into schema_migrations(version, name, applied_at)
  values (105, 'onboarding_progress', datetime('now'));
`;
