// Why the heartbeat last failed to queue an open task; cleared when it next queues it.
export const taskEnqueueErrorSchema = `
  alter table tasks add column enqueue_error text;

  insert into schema_migrations(version, name, applied_at)
  values (93, 'task_enqueue_error', datetime('now'));
`;
