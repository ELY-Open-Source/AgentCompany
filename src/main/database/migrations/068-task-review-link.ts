export const taskReviewLinkSchema = `
  alter table tasks add column review_of_task_id text references tasks(id) on delete set null;

  insert into schema_migrations(version, name, applied_at)
  values (68, 'task_review_link', datetime('now'));
`;
