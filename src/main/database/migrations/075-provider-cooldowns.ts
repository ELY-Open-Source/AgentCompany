export const providerCooldownsSchema = `
  create table if not exists provider_cooldowns (
    provider_id text primary key references providers(id) on delete cascade,
    label text not null,
    until_ms integer not null,
    strikes integer not null,
    interactive_probed_at_ms integer
  );

  insert into schema_migrations(version, name, applied_at)
  values (75, 'provider_cooldowns', datetime('now'));
`;
