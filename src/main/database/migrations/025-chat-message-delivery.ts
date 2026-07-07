export const chatMessageDeliverySchema = `
  alter table chat_messages add column body_structured_json text not null default '{}';
  alter table chat_messages add column delivery_state text not null default 'sent';

  create index if not exists idx_chat_messages_delivery_state
    on chat_messages(org_id, delivery_state, created_at);

  insert into schema_migrations(version, name, applied_at)
  values (25, 'chat_message_delivery', datetime('now'));
`;
