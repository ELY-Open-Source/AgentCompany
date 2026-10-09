// Verdicts on plain work, kept apart from tasks so deletions cannot rewrite them; past ones are read once from the audit trail.
export const workVerdictsSchema = `
  create table if not exists work_verdicts (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    task_id text,
    verdict text not null check (verdict in ('accepted', 'returned')),
    at text not null
  );
  create index if not exists work_verdicts_org_at on work_verdicts(org_id, at);

  with moves as (
    select e.id, e.org_id, e.entity_id as task_id, e.created_at as at, json_extract(e.payload_json, '$.status') as status,
      lag(json_extract(e.payload_json, '$.status')) over (partition by e.entity_id order by e.created_at, e.rowid) as from_status
    from audit_events e
    where e.entity_type = 'task' and e.action = 'status_changed'
  )
  insert into work_verdicts(id, org_id, task_id, verdict, at)
  select 'wv_' || m.id, m.org_id, m.task_id,
    case when m.status = 'done' then 'accepted' else 'returned' end, m.at
  from moves m join tasks t on t.id = m.task_id and t.origin is null
  where (m.status = 'done' and coalesce(m.from_status, '') <> 'done')
     or (m.from_status in ('review', 'done') and m.status in ('in_progress', 'backlog')
         and not exists (
           select 1 from approvals a join held_deliverables h on h.approval_id = a.id
           where h.task_id = m.task_id and a.kind = 'deliverable_review' and a.state = 'declined'
             and abs(julianday(m.at) - julianday(a.decided_at)) * 86400 < 5
         ));

  insert into work_verdicts(id, org_id, task_id, verdict, at)
  select 'wv_' || a.id, a.org_id, h.task_id, 'returned', a.decided_at
  from approvals a join held_deliverables h on h.approval_id = a.id join tasks t on t.id = h.task_id and t.origin is null
  where a.kind = 'deliverable_review' and a.state = 'declined' and a.decided_at is not null;

  insert into schema_migrations(version, name, applied_at)
  values (103, 'work_verdicts', datetime('now'));
`;
