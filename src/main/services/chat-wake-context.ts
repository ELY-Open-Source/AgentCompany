import type { DatabaseSync } from "node:sqlite";
import type { ChatContextBlock } from "./task-prompts";

interface ThreadMessageRow {
  body_md: string;
  created_at: string;
  edited_at: string | null;
  sender_type: string;
  sender_id: string | null;
  sender_name: string;
  sender_role: string | null;
}

/** The thread a chat-wake run answers, split at the agent's last reply. */
export function loadChatWakeContext(db: DatabaseSync, orgId: string, agentId: string, secretScopeJson: string): ChatContextBlock | null {
  const scope = JSON.parse(secretScopeJson) as { sourceThreadId?: string };
  if (!scope.sourceThreadId) return null;
  const thread = db.prepare("select space_id from chat_threads where id = ? and org_id = ?")
    .get(scope.sourceThreadId, orgId) as { space_id: string } | undefined;
  if (!thread) throw new Error(`Chat wake thread ${scope.sourceThreadId} no longer exists.`);
  const messages = db.prepare(`
    select m.body_md, m.created_at, m.edited_at, m.sender_type, m.sender_id,
           coalesce(a.name, e.display_name, m.sender_type) as sender_name,
           coalesce(a.role, e.role) as sender_role
    from chat_messages m
    left join agents a on a.id = m.sender_id and m.sender_type = 'agent'
    left join employees e on e.id = m.sender_id and m.sender_type = 'employee'
    where m.thread_id = ? and m.org_id = ?
    order by m.created_at asc
    limit 20
  `).all(scope.sourceThreadId, orgId) as unknown as ThreadMessageRow[];
  if (messages.length === 0) return null;
  const isOwn = (m: ThreadMessageRow) => m.sender_type === "agent" && m.sender_id === agentId;
  const ownReplies = messages.filter(isOwn);
  const lastReplyAt = ownReplies.length > 0 ? ownReplies[ownReplies.length - 1].created_at : "";
  const isFresh = (m: ThreadMessageRow) =>
    !isOwn(m) && (m.created_at > lastReplyAt || (m.edited_at !== null && m.edited_at > lastReplyAt));
  return {
    threadId: scope.sourceThreadId,
    spaceId: thread.space_id,
    history: messages.filter((m) => !isFresh(m)).map(formatMessage).join("\n"),
    fresh: messages.filter(isFresh).map(formatMessage).join("\n"),
  };
}

function formatMessage(m: ThreadMessageRow): string {
  const who = m.sender_role ? `${m.sender_name} (${m.sender_type}, ${m.sender_role})` : `${m.sender_name} (${m.sender_type})`;
  const edited = m.edited_at ? ` (edited ${utcMinute(m.edited_at)})` : "";
  return `[${utcMinute(m.created_at)}] ${who}${edited}: ${m.body_md}`;
}

function utcMinute(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Polls the threads this run is part of for messages from others. */
export function createRunMessagePoller(
  db: DatabaseSync,
  input: { orgId: string; agentId: string; sourceThreadId: string | null; runStartedAt: string },
): () => string | null {
  let watermark = input.runStartedAt;
  return () => {
    const rows = db.prepare(`
      select m.body_md, m.created_at, m.edited_at, m.sender_type, m.sender_id,
             coalesce(a.name, e.display_name, m.sender_type) as sender_name,
             coalesce(a.role, e.role) as sender_role
      from chat_messages m
      left join agents a on a.id = m.sender_id and m.sender_type = 'agent'
      left join employees e on e.id = m.sender_id and m.sender_type = 'employee'
      where m.org_id = ? and m.created_at > ? and m.deleted_at is null
        and not (m.sender_type = 'agent' and m.sender_id = ?)
        and (m.thread_id = ? or m.thread_id in (
          select own.thread_id from chat_messages own
          where own.org_id = ? and own.sender_type = 'agent' and own.sender_id = ? and own.created_at >= ?
        ))
      order by m.created_at asc
    `).all(input.orgId, watermark, input.agentId, input.sourceThreadId, input.orgId, input.agentId, input.runStartedAt) as unknown as ThreadMessageRow[];
    if (rows.length === 0) return null;
    watermark = rows[rows.length - 1].created_at;
    console.info(`[run-inbox] agent ${input.agentId}: ${rows.length} new message(s) injected mid-run`);
    return ["Messages that arrived while you were working (they may change what you should do):", ...rows.map(formatMessage)].join("\n");
  };
}
