// Agents' working language belongs to the company (and optionally a task), not to the app's display language; companies keep what they had.
export const workLanguageSchema = `
  alter table organizations add column work_language text not null default 'en' check (work_language in ('en', 'zh'));
  update organizations set work_language = coalesce((select case when language = 'zh' then 'zh' else 'en' end from app_state where id = 1), 'en');
  alter table tasks add column work_language text check (work_language is null or work_language in ('en', 'zh'));

  insert into schema_migrations(version, name, applied_at)
  values (104, 'work_language', datetime('now'));
`;
