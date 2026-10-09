// PR bot gates were switches that no task completion or goal close ever consulted, so turning one on blocked nothing.
export const dropPrBotGatesSchema = `
  drop table if exists pr_bot_gates;

  insert into schema_migrations(version, name, applied_at)
  values (95, 'drop_pr_bot_gates', datetime('now'));
`;
