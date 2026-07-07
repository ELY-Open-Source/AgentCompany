export const appStateSchema = `
  create table if not exists app_state (
    id integer primary key check (id = 1),
    active_org_id text references organizations(id) on delete set null,
    updated_at text not null
  );

  insert into app_state(id, active_org_id, updated_at)
  select 1, (select id from organizations order by created_at asc limit 1), datetime('now')
  where not exists (select 1 from app_state where id = 1);

  insert into schema_migrations(version, name, applied_at)
  values (6, 'app_state', datetime('now'));
`;
