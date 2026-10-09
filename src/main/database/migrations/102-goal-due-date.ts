// When a goal is planned to be reached; without it, progress is reported but no pace is claimed.
export const goalDueDateSchema = `
  alter table goals add column due_at text;

  insert into schema_migrations(version, name, applied_at)
  values (102, 'goal_due_date', datetime('now'));
`;
