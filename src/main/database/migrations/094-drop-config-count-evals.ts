// The SDLC review agents and eval suites only counted configuration rows, so their pass proved nothing about code or behavior.
export const dropConfigCountEvalsSchema = `
  drop table if exists sdlc_review_runs;
  drop table if exists sdlc_review_agents;
  drop table if exists eval_runs;
  drop table if exists eval_cases;
  drop table if exists eval_suites;

  insert into schema_migrations(version, name, applied_at)
  values (94, 'drop_config_count_evals', datetime('now'));
`;
