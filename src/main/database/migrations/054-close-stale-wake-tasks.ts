export const closeStaleWakeTasksSchema = `
  -- Chat-wake tasks are conversation vehicles: the reply run is their whole
  -- deliverable. Runs used to complete without closing them, stranding every
  -- "Reply to ..." row in the backlog forever (a task with a completed run is
  -- never enqueued again). Close each wake task whose runs have all been
  -- spent; run completion closes them from now on. In-flight wakes (a queued
  -- or running run) keep working normally.
  update tasks
  set status = 'done', updated_at = datetime('now')
  where status in ('backlog', 'in_progress')
    and exists (select 1 from task_runs r where r.task_id = tasks.id and r.trigger = 'chat_mention')
    and not exists (select 1 from task_runs r where r.task_id = tasks.id and r.state in ('queued', 'running'));

  insert into schema_migrations(version, name, applied_at)
  values (54, 'close_stale_wake_tasks', datetime('now'));
`;
