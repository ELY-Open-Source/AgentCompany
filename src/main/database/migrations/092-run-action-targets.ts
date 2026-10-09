// What each journaled action acted on; rows from before stay null, meaning any later success of the same tool redoes them.
export const runActionTargetsSchema = `
  alter table run_actions add column target text;

  insert into schema_migrations(version, name, applied_at)
  values (92, 'run_action_targets', datetime('now'));
`;
