export const filesPinnedAndScheduledPosts = `
  alter table file_objects add column pinned integer not null default 0;
  alter table file_objects add column space_id text;
  alter table file_objects add column updated_at text;

  create table if not exists scheduled_posts (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    social_account_id text not null references social_accounts(id) on delete cascade,
    body_md text not null,
    scheduled_for text not null,
    state text not null,
    approval_id text references approvals(id) on delete set null,
    created_by_employee_id text references employees(id) on delete set null,
    created_at text not null,
    updated_at text not null
  );

  create index if not exists idx_files_org_pinned on file_objects(org_id, pinned);
  create index if not exists idx_scheduled_posts_org_state on scheduled_posts(org_id, state);
  create index if not exists idx_scheduled_posts_account_date on scheduled_posts(social_account_id, scheduled_for);

  insert into schema_migrations(version, name, applied_at)
  values (4, 'files_pinned_and_scheduled_posts', datetime('now'));
`;
