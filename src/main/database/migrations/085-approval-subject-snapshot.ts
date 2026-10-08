// Existing task approvals are taken to cover the task as it stands now; from here on an edit needs a fresh one.
export const approvalSubjectSnapshotSchema = `
  alter table approvals add column subject_snapshot text;
  update approvals set subject_snapshot = (
    select json_object('title', t.title, 'description', t.description, 'assignee', t.assignee_agent_id, 'risk', t.risk, 'workspace', t.workspace_id, 'filesystem', t.requires_filesystem)
    from tasks t where t.id = approvals.source_entity_id
  )
  where source_entity_type = 'task' and kind in ('task_risk', 'task_execution');

  insert into schema_migrations(version, name, applied_at)
  values (85, 'approval_subject_snapshot', datetime('now'));
`;
