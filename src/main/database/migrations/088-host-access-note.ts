// Pending file-access approvals made before the warning existed get it too; the text is frozen here as it was introduced.
export const hostAccessNoteSchema = `
  update approvals
  set details = details || char(10) || char(10) || 'Approving lets this task run commands on this computer with your user''s file access: they can read and change files outside the workspace. Only their environment is cleaned of keys and your profile.'
  where state = 'pending' and source_entity_type = 'task' and kind in ('task_risk', 'task_execution')
    and source_entity_id in (select id from tasks where requires_filesystem = 1)
    and details not like '%Approving lets this task run commands on this computer%';

  insert into schema_migrations(version, name, applied_at)
  values (88, 'host_access_note', datetime('now'));
`;
