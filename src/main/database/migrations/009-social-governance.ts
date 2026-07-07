export const socialGovernanceSchema = `
  update social_account_grants
  set scope_json = '{"actions":["login","draft","approve"],"riskCeiling":"medium"}'
  where scope_json = '{"actions":["login","draft","approve"]}';

  create temp table if not exists social_post_approval_backfill(
    post_id text primary key,
    approval_id text not null
  );

  delete from social_post_approval_backfill;

  insert into social_post_approval_backfill(post_id, approval_id)
  select id, 'app_' || lower(hex(randomblob(16)))
  from scheduled_posts
  where state = 'scheduled' and approval_id is null;

  insert into approvals(
    id, org_id, kind, title, details, risk, requested_by_type, requested_by_id,
    state, decided_by_employee_id, created_at, decided_at
  )
  select
    backfill.approval_id,
    posts.org_id,
    'social_publish',
    'Approve social post',
    posts.body_md,
    'medium',
    case when posts.created_by_employee_id is null then 'system' else 'employee' end,
    posts.created_by_employee_id,
    'pending',
    null,
    posts.created_at,
    null
  from scheduled_posts posts
  join social_post_approval_backfill backfill on backfill.post_id = posts.id;

  update scheduled_posts
  set approval_id = (
    select approval_id from social_post_approval_backfill
    where social_post_approval_backfill.post_id = scheduled_posts.id
  )
  where id in (select post_id from social_post_approval_backfill);

  drop table social_post_approval_backfill;

  insert into schema_migrations(version, name, applied_at)
  values (9, 'social_governance', datetime('now'));
`;
