export const taskWritingModeSchema = `
  alter table tasks add column writing_mode text not null default 'conversational'
    check (writing_mode in ('conversational', 'technical', 'structured'));

  insert into schema_migrations(version, name, applied_at)
  values (66, 'task_writing_mode', datetime('now'));
`;
