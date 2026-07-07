export const approvalSourceRefsSchema = `
  alter table approvals add column source_entity_type text;
  alter table approvals add column source_entity_id text;

  update approvals
  set
    source_entity_type = 'task',
    source_entity_id = (
      select tasks.id
      from tasks
      where tasks.org_id = approvals.org_id
        and tasks.title = approvals.title
        and tasks.description = approvals.details
      order by tasks.created_at desc
      limit 1
    )
  where kind = 'task_risk'
    and source_entity_id is null
    and exists (
      select 1
      from tasks
      where tasks.org_id = approvals.org_id
        and tasks.title = approvals.title
        and tasks.description = approvals.details
    );

  update approvals
  set
    source_entity_type = 'scheduled_post',
    source_entity_id = (
      select scheduled_posts.id
      from scheduled_posts
      where scheduled_posts.approval_id = approvals.id
      limit 1
    )
  where kind = 'social_publish'
    and source_entity_id is null
    and exists (
      select 1
      from scheduled_posts
      where scheduled_posts.approval_id = approvals.id
    );

  create index if not exists idx_approvals_source
    on approvals(org_id, source_entity_type, source_entity_id, kind, state);

  insert into schema_migrations(version, name, applied_at)
  values (30, 'approval_source_refs', datetime('now'));
`;
