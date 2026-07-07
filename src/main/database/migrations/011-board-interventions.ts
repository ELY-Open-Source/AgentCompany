export const boardInterventionSchema = `
  alter table chat_threads add column board_state text not null default 'open';
  alter table chat_threads add column controlled_by_type text;
  alter table chat_threads add column controlled_by_id text;

  create table if not exists board_interventions (
    id text primary key,
    org_id text not null references organizations(id) on delete cascade,
    thread_id text not null references chat_threads(id) on delete cascade,
    message_id text not null references chat_messages(id) on delete cascade,
    mode text not null,
    action text not null,
    details text not null,
    target_type text,
    target_id text,
    approval_id text references approvals(id) on delete set null,
    created_by_type text not null,
    created_by_id text,
    created_at text not null,
    unique(message_id)
  );

  create index if not exists idx_board_interventions_org_thread on board_interventions(org_id, thread_id, created_at);
  create index if not exists idx_board_interventions_message on board_interventions(message_id);
  create index if not exists idx_chat_threads_org_board_state on chat_threads(org_id, board_state);

  insert into schema_migrations(version, name, applied_at)
  values (11, 'board_interventions', datetime('now'));
`;
