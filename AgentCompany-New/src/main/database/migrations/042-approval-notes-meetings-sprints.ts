export const approvalNotesMeetingsSprintsSchema = `
  alter table approvals add column decision_notes text;

  create table if not exists meetings (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    title text not null,
    meeting_type text not null,
    status text not null,
    scheduled_at text,
    duration_minutes integer not null,
    agenda text not null,
    notes text not null,
    decisions text not null,
    created_at text not null,
    updated_at text not null
  );

  create index if not exists idx_meetings_org on meetings(org_id, scheduled_at);

  create table if not exists sprints (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    name text not null,
    goal text not null,
    status text not null,
    start_date text not null,
    end_date text not null,
    velocity_points integer not null default 0,
    completed_points integer not null default 0,
    retrospective text not null,
    created_at text not null,
    updated_at text not null
  );

  create index if not exists idx_sprints_org on sprints(org_id, status);
`;
