export const mentionWakeStateSchema = `
  alter table chat_mentions add column wake_state text not null default 'none';
`;
