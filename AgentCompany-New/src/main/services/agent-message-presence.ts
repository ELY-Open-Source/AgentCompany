import type { DatabaseSync } from "node:sqlite";

/**
 * What the sending agent hears back: who is in the channel and who they just
 * addressed — the presence of real colleagues, not a transaction id. Hearing
 * the room is what lets an agent hold a conversation instead of posting into a
 * void, while the thread_id keeps the next reply on the same thread.
 */
export function describeSend(db: DatabaseSync, selfAgentId: string, channel: string, spaceId: string, messageId: string, threadId: string): string {
  const addressed = mentionedTeammates(db, selfAgentId, messageId);
  const present = channelTeammates(db, selfAgentId, spaceId, addressed);
  const lines = [`Your message is up in #${channel}.`];
  const replyReady = addressed.filter((teammate) => teammate.canReply).map((teammate) => teammate.name);
  const mentionedOnly = addressed.filter((teammate) => !teammate.canReply).map((teammate) => teammate.name);
  if (replyReady.length > 0) lines.push(`${joinNames(replyReady)} can see it and reply here.`);
  if (mentionedOnly.length > 0) lines.push(`${joinNames(mentionedOnly)} was mentioned in this thread.`);
  if (present.length > 0) lines.push(`Also in the room: ${joinNames(present)}.`);
  lines.push(`To stay in this conversation, reply with thread_id="${threadId}".`);
  return lines.join(" ");
}

interface MentionedTeammate {
  name: string;
  canReply: boolean;
}

function mentionedTeammates(db: DatabaseSync, selfAgentId: string, messageId: string): MentionedTeammate[] {
  const wakePattern = `%"sourceMessageId":"${messageId}"%`;
  const rows = db.prepare(`
    select coalesce(a.name, e.display_name) as name,
           case
             when m.target_type = 'employee' then 1
             when exists (
               select 1
               from task_runs r
               where r.agent_id = m.target_id
                 and r.trigger = 'chat_mention'
                 and r.secret_scope_json like ?
             ) then 1
             else 0
           end as can_reply
    from chat_mentions m
    left join agents a on a.id = m.target_id and m.target_type = 'agent'
    left join employees e on e.id = m.target_id and m.target_type = 'employee'
    where m.message_id = ? and m.target_type in ('agent', 'employee') and m.target_id <> ?
  `).all(wakePattern, messageId, selfAgentId) as Array<{ name: string | null; can_reply: number }>;
  return dedupeTeammates(rows);
}

function channelTeammates(db: DatabaseSync, selfAgentId: string, spaceId: string, addressed: MentionedTeammate[]): string[] {
  const alreadyNamed = new Set(addressed.map((teammate) => teammate.name));
  const rows = db.prepare(`
    select coalesce(a.name, e.display_name) as name
    from chat_memberships cm
    left join agents a on a.id = cm.principal_id and cm.principal_type = 'agent'
    left join employees e on e.id = cm.principal_id and cm.principal_type = 'employee'
    where cm.space_id = ? and cm.principal_id <> ?
  `).all(spaceId, selfAgentId) as Array<{ name: string | null }>;
  return dedupeNames(rows).filter((name) => !alreadyNamed.has(name)).slice(0, 6);
}

function dedupeNames(rows: Array<{ name: string | null }>): string[] {
  const names = new Set<string>();
  for (const row of rows) if (row.name) names.add(row.name);
  return [...names];
}

function dedupeTeammates(rows: Array<{ name: string | null; can_reply: number }>): MentionedTeammate[] {
  const teammates = new Map<string, MentionedTeammate>();
  for (const row of rows) {
    if (!row.name) continue;
    const existing = teammates.get(row.name);
    const canReply = row.can_reply === 1;
    teammates.set(row.name, { name: row.name, canReply: canReply || existing?.canReply === true });
  }
  return [...teammates.values()];
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
