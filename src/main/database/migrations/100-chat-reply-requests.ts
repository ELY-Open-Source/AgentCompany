// Every message that asked an agent for a reply, and the wake task answering it; a message folded into a queued wake shares its task.
export const chatReplyRequestsSchema = `
  create table if not exists chat_reply_requests (
    message_id text not null references chat_messages(id) on delete cascade,
    agent_id text not null references agents(id) on delete cascade,
    task_id text not null references tasks(id) on delete cascade,
    created_at text not null,
    primary key (message_id, agent_id)
  );

  insert or ignore into chat_reply_requests(message_id, agent_id, task_id, created_at)
  select json_extract(r.secret_scope_json, '$.sourceMessageId'), r.agent_id, r.task_id, r.created_at
  from task_runs r
  where r.trigger = 'chat_mention'
    and exists (select 1 from chat_messages m where m.id = json_extract(r.secret_scope_json, '$.sourceMessageId'));

  insert into schema_migrations(version, name, applied_at)
  values (100, 'chat_reply_requests', datetime('now'));
`;
