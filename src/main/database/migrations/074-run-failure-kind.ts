/** The message signatures earlier builds classified transient failures by; frozen here to heal their rows. */
const TRANSIENT_PROVIDER_FAILURE_SIGNATURES = ["provider monthly request limit has been reached.", "usage limit", "rate limit", "too many requests", "overloaded"];

/** Runs record whether they failed for a passing provider reason; older rows are classified from their message once, here. */
export const runFailureKindSchema = `
  alter table task_runs add column failure_kind text check (failure_kind in ('transient'));

  update task_runs set failure_kind = 'transient'
  where state = 'failed' and (${TRANSIENT_PROVIDER_FAILURE_SIGNATURES.map((signature) => `lower(error_message) like '%${signature.replaceAll("'", "''")}%'`).join(" or ")});

  insert into schema_migrations(version, name, applied_at)
  values (74, 'run_failure_kind', datetime('now'));
`;
