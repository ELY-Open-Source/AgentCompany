import { attachmentNote } from "./agent-attachment-tools";
import { optionalString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { JsonRecord } from "./provider-http";

interface Sender {
  sender_type: string;
  sender_name: string;
  sender_role: string | null;
}

interface MessageFilter {
  before: { createdAt: string; rowid: number } | null;
  query: string | null;
  limit: number;
}

export function readMessagesTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const channel = optionalString(args.channel);
  const withTeammate = optionalString(args.with);
  const threadId = optionalString(args.thread_id);
  if ([channel, withTeammate, threadId].filter(Boolean).length > 1) {
    throw new Error('Pass only one of "channel", "with", or "thread_id".');
  }
  const filter: MessageFilter = {
    before: beforeCursor(deps, ctx.orgId, optionalString(args.before)),
    query: optionalString(args.query),
    limit: Math.min(Math.max(Number(args.limit) || 10, 1), 30),
  };
  if (withTeammate) {
    const counterpart = deps.db.prepare(`
      select id, name, 'agent' as kind from agents where org_id = ? and lower(name) = lower(?) and lifecycle = 'active'
      union all
      select id, display_name as name, 'employee' as kind from employees where org_id = ? and lower(display_name) = lower(?)
      limit 1
    `).get(ctx.orgId, withTeammate, ctx.orgId, withTeammate) as { id: string; name: string; kind: "agent" | "employee" } | undefined;
    if (!counterpart) throw new Error(`No teammate named "${withTeammate}".`);
    const spaceId = deps.chat.ensureDirectSpace(
      ctx.orgId,
      { type: "agent", id: ctx.agent.id },
      { type: counterpart.kind, id: counterpart.id },
    );
    return messagePage(deps, ctx.orgId, { column: "space_id", id: spaceId }, filter, `your direct conversation with ${counterpart.name}`);
  }
  if (channel) {
    const space = deps.db.prepare(
      "select id from chat_spaces where org_id = ? and lower(name) = lower(?) and space_type <> 'direct' limit 1",
    ).get(ctx.orgId, channel) as { id: string } | undefined;
    if (!space) throw new Error(`No channel named "${channel}".`);
    return messagePage(deps, ctx.orgId, { column: "space_id", id: space.id }, filter, `#${channel}`);
  }
  if (threadId) {
    const thread = deps.db.prepare("select id from chat_threads where id = ? and org_id = ?").get(threadId, ctx.orgId);
    if (!thread) throw new Error(`No thread with thread_id "${threadId}".`);
    return messagePage(deps, ctx.orgId, { column: "thread_id", id: threadId }, filter, `thread ${threadId}`);
  }
  return unansweredMentions(deps, ctx, filter.limit);
}

function messagePage(
  deps: AgentToolDeps,
  orgId: string,
  scope: { column: "space_id" | "thread_id"; id: string },
  filter: MessageFilter,
  label: string,
): string {
  const rows = deps.db.prepare(`
    select m.id, m.rowid as row_id, m.body_md, m.created_at, m.thread_id, m.sender_type,
           coalesce(a.name, e.display_name, m.sender_type) as sender_name,
           coalesce(a.role, e.role) as sender_role
    from chat_messages m
    left join agents a on a.id = m.sender_id and m.sender_type = 'agent'
    left join employees e on e.id = m.sender_id and m.sender_type in ('employee', 'board')
    where m.${scope.column} = ? and m.org_id = ? and m.deleted_at is null
      and (? is null or m.created_at < ? or (m.created_at = ? and m.rowid < ?))
      and (? is null or instr(lower(m.body_md), lower(?)) > 0)
    order by m.created_at desc, m.rowid desc
    limit ?
  `).all(
    scope.id, orgId,
    filter.before?.createdAt ?? null, filter.before?.createdAt ?? null, filter.before?.createdAt ?? null, filter.before?.rowid ?? null,
    filter.query, filter.query, filter.limit + 1,
  ) as unknown as Array<{ id: string; row_id: number; body_md: string; created_at: string; thread_id: string } & Sender>;
  if (rows.length === 0) return `No messages${filter.query ? ` matching "${filter.query}"` : ""}${filter.before ? " before that point" : ""} in ${label}.`;
  const page = rows.slice(0, filter.limit).reverse();
  const lines = page.map((m) => `[${m.created_at}] ${senderLabel(m)} (thread=${m.thread_id}): ${m.body_md}${attachmentNote(deps.db, m.id)}`);
  if (rows.length > filter.limit) lines.unshift(`(Older messages exist: pass before="${page[0].id}" to read them.)`);
  return lines.join("\n");
}

function unansweredMentions(deps: AgentToolDeps, ctx: AgentToolContext, limit: number): string {
  const rows = deps.db.prepare(`
    select m.id, m.body_md, m.sender_type,
           coalesce(a.name, e.display_name, m.sender_type) as sender_name,
           coalesce(a.role, e.role) as sender_role,
           m.thread_id, s.name as channel_name, s.space_type
    from chat_mentions cm
    join chat_messages m on m.id = cm.message_id
    join chat_spaces s on s.id = m.space_id
    left join agents a on a.id = m.sender_id and m.sender_type = 'agent'
    left join employees e on e.id = m.sender_id and m.sender_type in ('employee', 'board')
    where cm.target_type = 'agent' and cm.target_id = ? and m.org_id = ? and m.deleted_at is null
      and not exists (
        select 1 from chat_messages reply
        where reply.thread_id = m.thread_id and reply.sender_type = 'agent' and reply.sender_id = cm.target_id
          and reply.created_at > coalesce(m.edited_at, m.created_at) and reply.deleted_at is null
      )
    order by m.created_at desc
    limit ?
  `).all(ctx.agent.id, ctx.orgId, limit) as unknown as Array<{ id: string; body_md: string; thread_id: string; channel_name: string; space_type: string } & Sender>;
  if (rows.length === 0) return "No unanswered mentions.";
  return rows.reverse().map((m) => {
    const where = m.space_type === "direct" ? "in your direct conversation" : `in #${m.channel_name}`;
    return `[${senderLabel(m)} ${where}] (thread=${m.thread_id}): ${m.body_md}${attachmentNote(deps.db, m.id)}`;
  }).join("\n");
}

/** A message_id cursor from a previous page, or a UTC time. */
function beforeCursor(deps: AgentToolDeps, orgId: string, text: string | null): MessageFilter["before"] {
  if (!text) return null;
  if (text.startsWith("msg_")) {
    const row = deps.db.prepare("select created_at, rowid as row_id from chat_messages where id = ? and org_id = ?")
      .get(text, orgId) as { created_at: string; row_id: number } | undefined;
    if (!row) throw new Error(`No message with id "${text}".`);
    return { createdAt: row.created_at, rowid: row.row_id };
  }
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{3})?Z$/.exec(text);
  const normalized = match ? `${match[1]}${match[2] ?? ".000"}Z` : "";
  const time = new Date(normalized);
  if (!match || Number.isNaN(time.getTime()) || time.toISOString() !== normalized) {
    throw new Error(`"before" must be a message_id from a previous page or a UTC ISO timestamp like 2026-01-31T09:00:00Z, got "${text}".`);
  }
  return { createdAt: normalized, rowid: -1 };
}

function senderLabel(m: Sender): string {
  return m.sender_role ? `${m.sender_name} (${m.sender_type}, ${m.sender_role})` : `${m.sender_name} (${m.sender_type})`;
}
