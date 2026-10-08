export const chatWakeTextPurgeSchema = `
  update tasks
  set title = case when title like 'Chat mention:%' then 'Reply in chat' else title end,
      description = 'Reply in the source thread with send_message and its thread_id; the full message is in the thread below.'
  where origin = 'chat_wake';

  insert into schema_migrations(version, name, applied_at)
  values (60, 'chat_wake_text_purge', datetime('now'));
`;
