import type { DatabaseSync } from "node:sqlite";
import type { ChatContextBlock } from "./task-prompts";
import { attachmentNote } from "./agent-attachment-tools";

const HISTORY_LIMIT = 20;

const MESSAGE_SELECT = `
  select m.id, m.body_md, m.created_at, m.edited_at, m.sender_type, m.sender_id,
         coalesce(a.name, e.display_name, m.sender_type) as sender_name,
         coalesce(a.role, e.role) as sender_role
  from chat_messages m
  left join agents a on a.id = m.sender_id and m.sender_type = 'agent'
  left join employees e on e.id = m.sender_id and m.sender_type = 'employee'`;

interface ThreadMessageRow {
  id: string;
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
  const lastReplyAt = (db.prepare(`
    select coalesce(max(created_at), '') as at from chat_messages
    where thread_id = ? and org_id = ? and sender_type = 'agent' and sender_id = ? and deleted_at is null
  `).get(scope.sourceThreadId, orgId, agentId) as { at: string }).at;
  const isFresh = `not (m.sender_type = 'agent' and m.sender_id = ?) and (m.created_at > ? or coalesce(m.edited_at, '') > ?)`;
  const inThread = "m.thread_id = ? and m.org_id = ? and m.deleted_at is null";
  const args = [scope.sourceThreadId, orgId, agentId, lastReplyAt, lastReplyAt];
  const fresh = db.prepare(`${MESSAGE_SELECT} where ${inThread} and ${isFresh} order by m.created_at asc`)
    .all(...args) as unknown as ThreadMessageRow[];
  const history = (db.prepare(`${MESSAGE_SELECT} where ${inThread} and not (${isFresh}) order by m.created_at desc limit ?`)
    .all(...args, HISTORY_LIMIT) as unknown as ThreadMessageRow[]).reverse();
  const historyTotal = (db.prepare(`select count(*) as n from chat_messages m where ${inThread} and not (${isFresh})`)
    .get(...args) as { n: number }).n;
  if (fresh.length === 0 && history.length === 0) return null;
  const omitted = historyTotal - history.length;
  return {
    threadId: scope.sourceThreadId,
    spaceId: thread.space_id,
    history: [...(omitted > 0 ? [`(${omitted} earlier messages in this thread are not shown.)`] : []), ...history.map((m) => formatMessage(db, m))].join("\n"),
    fresh: fresh.map((m) => formatMessage(db, m)).join("\n"),
  };
}

function formatMessage(db: DatabaseSync, m: ThreadMessageRow): string {
  const who = m.sender_role ? `${m.sender_name} (${m.sender_type}, ${m.sender_role})` : `${m.sender_name} (${m.sender_type})`;
  const edited = m.edited_at ? ` (edited ${utcMinute(m.edited_at)})` : "";
  return `[${utcMinute(m.created_at)}] ${who}${edited}: ${m.body_md}${attachmentNote(db, m.id)}`;
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
    const rows = db.prepare(`${MESSAGE_SELECT}
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
    return ["Messages that arrived while you were working (they may change what you should do):", ...rows.map((m) => formatMessage(db, m))].join("\n");
  };
}
