export const integrationKeysSchema = `
  create table if not exists integration_keys (
    name text primary key,
    ciphertext blob not null,
    updated_at text not null
  );

  insert into schema_migrations(version, name, applied_at)
  values (58, 'integration_keys', datetime('now'));
`;
