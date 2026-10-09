// Why the operator blocked a task; while set, no session starts on it.
export const taskBlockedSchema = `
  alter table tasks add column blocked_reason text;

  insert into schema_migrations(version, name, applied_at)
  values (101, 'task_blocked', datetime('now'));
`;
