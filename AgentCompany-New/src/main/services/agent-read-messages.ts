import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { JsonRecord } from "./provider-http";

export function readMessagesTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const channel = optionalString(args.channel);
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30);
  if (channel) {
    const space = deps.db.prepare(
      "select id from chat_spaces where org_id = ? and lower(name) = lower(?) and space_type <> 'direct' limit 1",
    ).get(ctx.orgId, channel) as { id: string } | undefined;
    if (!space) throw new Error(`No channel named "${channel}".`);
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
    `).all(space.id, ctx.orgId, limit) as Array<{ body_md: string; sender_name: string; thread_id: string }>;
    if (rows.length === 0) return `No recent messages in #${channel}.`;
    return rows.reverse().map((m) => `[${m.sender_name}] (thread=${m.thread_id}): ${m.body_md}`).join("\n");
  }
  const rows = deps.db.prepare(`
    select m.body_md,
           coalesce(a.name, e.display_name, m.sender_type) as sender_name,
           m.thread_id, s.name as channel_name
    from chat_mentions cm
    join chat_messages m on m.id = cm.message_id
    join chat_spaces s on s.id = m.space_id
    left join agents a on a.id = m.sender_id and m.sender_type = 'agent'
    left join employees e on e.id = m.sender_id and m.sender_type = 'employee'
    where cm.target_type = 'agent' and cm.target_id = ? and m.org_id = ? and m.deleted_at is null
    order by m.created_at desc
    limit ?
  `).all(ctx.agent.id, ctx.orgId, limit) as Array<{ body_md: string; sender_name: string; thread_id: string; channel_name: string }>;
  if (rows.length === 0) return "No recent mentions.";
  return rows.reverse().map((m) => `[${m.sender_name} in #${m.channel_name}] (thread=${m.thread_id}): ${m.body_md}`).join("\n");
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
