export const modelChecksSchema = `
  create table model_checks (
    provider_id text not null references providers(id) on delete cascade,
    model text not null,
    credential_id text not null,
    org_id text not null,
    passed integer not null,
    detail text,
    checked_at text not null,
    primary key (provider_id, model, credential_id)
  );

  insert into schema_migrations(version, name, applied_at)
  values (77, 'model_checks', datetime('now'));
`;
