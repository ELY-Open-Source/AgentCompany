import type { DatabaseSync } from "node:sqlite";

/** The agent that answers a channel message naming no one: its most senior active member with an enabled provider. */
export function channelAnchorAgentId(db: DatabaseSync, orgId: string, spaceId: string): string | null {
  const anchor = db.prepare(`
    select a.id as agent_id
    from chat_memberships cm
    join agents a on a.id = cm.principal_id and a.org_id = ?
    join providers p on p.id = a.model_provider_id and p.org_id = a.org_id
    where cm.space_id = ? and cm.principal_type = 'agent'
      and a.lifecycle = 'active'
      and p.enabled = 1
    order by case a.role_level when 'c_suite' then 0 when 'director' then 1 when 'lead' then 2 else 3 end,
             a.created_at asc
    limit 1
  `).get(orgId, spaceId) as { agent_id: string } | undefined;
  return anchor?.agent_id ?? null;
}
