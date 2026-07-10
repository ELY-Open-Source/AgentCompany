export const taskOriginSchema = `
  -- Task provenance. 'chat_wake' marks conversation vehicles created by a
  -- mention wake, 'goal_review' marks the CEO's goal checkpoints; plain work
  -- (kickoffs, agent- and operator-created tasks) stays null. The goal-review
  -- scheduler needs this to tell real progress from chatter — otherwise every
  -- auto-closed reply task would count as progress and reviews would spawn
  -- forever.
  alter table tasks add column origin text;

  -- Backfill: every existing wake vehicle is identifiable by its chat_mention
  -- run (only the wake service ever creates those runs).
  update tasks set origin = 'chat_wake'
  where origin is null
    and exists (select 1 from task_runs r where r.task_id = tasks.id and r.trigger = 'chat_mention');

  insert into schema_migrations(version, name, applied_at)
  values (55, 'task_origin', datetime('now'));
`;
