export const goalAuditorSchema = `
  alter table organizations add column audit_provider_id text;
  alter table organizations add column audit_model_id text;

  insert into schema_migrations(version, name, applied_at)
  values (87, 'goal_auditor', datetime('now'));
`;
