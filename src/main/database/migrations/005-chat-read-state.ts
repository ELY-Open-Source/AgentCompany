export const chatReadState = `
  create table if not exists chat_read_state (
    org_id text not null references organizations(id) on delete cascade,
    employee_id text not null references employees(id) on delete cascade,
    space_id text not null references chat_spaces(id) on delete cascade,
    last_read_message_id text references chat_messages(id) on delete set null,
    last_read_at text not null,
    primary key (employee_id, space_id)
  );

  create index if not exists idx_chat_read_state_org on chat_read_state(org_id, employee_id);

  insert into schema_migrations(version, name, applied_at)
  values (5, 'chat_read_state', datetime('now'));
`;
