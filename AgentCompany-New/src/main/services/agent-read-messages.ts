import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { JsonRecord } from "./provider-http";

export function readMessagesTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const channel = optionalString(args.channel);
  const withTeammate = optionalString(args.with);
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30);
  if (channel && withTeammate) throw new Error('Pass either "channel" or "with", not both.');
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
    const rows = recentMessagesIn(deps, ctx.orgId, spaceId, limit);
    if (rows.length === 0) return `No messages yet in your direct conversation with ${counterpart.name}.`;
    return rows.map((m) => `[${m.sender_name}] (thread=${m.thread_id}): ${m.body_md}`).join("\n");
  }
  if (channel) {
    const space = deps.db.prepare(
      "select id from chat_spaces where org_id = ? and lower(name) = lower(?) and space_type <> 'direct' limit 1",
    ).get(ctx.orgId, channel) as { id: string } | undefined;
    if (!space) throw new Error(`No channel named "${channel}".`);
    const rows = recentMessagesIn(deps, ctx.orgId, space.id, limit);
    if (rows.length === 0) return `No recent messages in #${channel}.`;
    return rows.map((m) => `[${m.sender_name}] (thread=${m.thread_id}): ${m.body_md}`).join("\n");
  }
  const rows = deps.db.prepare(`
    select m.body_md,
           coalesce(a.name, e.display_name, m.sender_type) as sender_name,
           m.thread_id, s.name as channel_name, s.space_type
    from chat_mentions cm
    join chat_messages m on m.id = cm.message_id
    join chat_spaces s on s.id = m.space_id
    left join agents a on a.id = m.sender_id and m.sender_type = 'agent'
    left join employees e on e.id = m.sender_id and m.sender_type = 'employee'
    where cm.target_type = 'agent' and cm.target_id = ? and m.org_id = ? and m.deleted_at is null
    order by m.created_at desc
    limit ?
  `).all(ctx.agent.id, ctx.orgId, limit) as Array<{ body_md: string; sender_name: string; thread_id: string; channel_name: string; space_type: string }>;
  if (rows.length === 0) return "No recent mentions.";
  return rows.reverse().map((m) => {
    const where = m.space_type === "direct" ? "in your direct conversation" : `in #${m.channel_name}`;
    return `[${m.sender_name} ${where}] (thread=${m.thread_id}): ${m.body_md}`;
  }).join("\n");
}

function recentMessagesIn(
  deps: AgentToolDeps,
  orgId: string,
  spaceId: string,
  limit: number,
): Array<{ body_md: string; sender_name: string; thread_id: string }> {
  const rows = deps.db.prepare(`
    select m.body_md,
           coalesce(a.name, e.display_name, m.sender_type) as sender_name,
           m.thread_id
    from chat_messages m
    left join agents a on a.id = m.sender_id and m.sender_type = 'agent'
    left join employees e on e.id = m.sender_id and m.sender_type = 'employee'
    where m.space_id = ? and m.org_id = ? and m.deleted_at is null
    order by m.created_at desc
    limit ?
  `).all(spaceId, orgId, limit) as Array<{ body_md: string; sender_name: string; thread_id: string }>;
  return rows.reverse();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
