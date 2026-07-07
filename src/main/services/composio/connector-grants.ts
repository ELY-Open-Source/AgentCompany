import type { DatabaseSync } from "node:sqlite";
import { createId } from "../../../shared/ids";

export interface ConnectorAccountRow {
  id: string;
  orgId: string;
  toolkitSlug: string;
  toolkitName: string;
  status: string;
}

export interface ConnectorGrantRow {
  id: string;
  orgId: string;
  agentId: string;
  toolkitSlug: string;
}

/**
 * Which agents may use which connected toolkits. Connections belong to the
 * company (one connected account per toolkit per org); the CEO carries every
 * active connection by role and hands individual toolkits to individual
 * agents. Both the tool loadout and the execution guard read from here.
 */
export class ConnectorGrantsService {
  constructor(private readonly db: DatabaseSync) {}

  grant(input: { orgId: string; agentId: string; toolkitSlug: string; grantedByType: "agent" | "employee"; grantedById: string | null }): void {
    const agent = this.db.prepare("select id from agents where id = ? and org_id = ? and lifecycle = 'active'")
      .get(input.agentId, input.orgId);
    if (!agent) throw new Error("Grant target must be an active agent in this organization.");
    const slug = normalizeSlug(input.toolkitSlug);
    const account = this.db.prepare(
      "select id from connector_accounts where org_id = ? and toolkit_slug = ? and status = 'ACTIVE'",
    ).get(input.orgId, slug);
    if (!account) throw new Error(`No active connection for toolkit "${slug}". Connect it on the Connectors page first.`);
    this.db.prepare(`
      insert into agent_connector_grants(id, org_id, agent_id, toolkit_slug, granted_by_type, granted_by_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(org_id, agent_id, toolkit_slug) do nothing
    `).run(createId("cgr"), input.orgId, input.agentId, slug, input.grantedByType, input.grantedById, new Date().toISOString());
  }

  revoke(input: { orgId: string; agentId: string; toolkitSlug: string }): void {
    this.db.prepare("delete from agent_connector_grants where org_id = ? and agent_id = ? and toolkit_slug = ?")
      .run(input.orgId, input.agentId, normalizeSlug(input.toolkitSlug));
  }

  /**
   * Toolkits this agent may use. The CEO carries every actively connected
   * toolkit by role; every other agent needs a grant AND an active
   * connection.
   */
  toolkitsForAgent(orgId: string, agentId: string): string[] {
    const acting = this.db.prepare("select role_level from agents where id = ? and org_id = ?")
      .get(agentId, orgId) as { role_level: string } | undefined;
    if (acting?.role_level === "c_suite") {
      return this.activeAccounts(orgId).map((account) => account.toolkitSlug);
    }
    const rows = this.db.prepare(`
      select g.toolkit_slug as slug
      from agent_connector_grants g
      join connector_accounts a on a.org_id = g.org_id and a.toolkit_slug = g.toolkit_slug and a.status = 'ACTIVE'
      where g.org_id = ? and g.agent_id = ?
      order by g.toolkit_slug asc
    `).all(orgId, agentId) as Array<{ slug: string }>;
    return rows.map((row) => row.slug);
  }

  activeAccounts(orgId: string): ConnectorAccountRow[] {
    const rows = this.db.prepare(`
      select id, org_id, toolkit_slug, toolkit_name, status
      from connector_accounts
      where org_id = ? and status = 'ACTIVE'
      order by toolkit_slug asc
    `).all(orgId) as Array<{ id: string; org_id: string; toolkit_slug: string; toolkit_name: string; status: string }>;
    return rows.map((row) => ({
      id: row.id,
      orgId: row.org_id,
      toolkitSlug: row.toolkit_slug,
      toolkitName: row.toolkit_name,
      status: row.status,
    }));
  }

  grantsForOrg(orgId: string): ConnectorGrantRow[] {
    const rows = this.db.prepare(`
      select id, org_id, agent_id, toolkit_slug
      from agent_connector_grants
      where org_id = ?
      order by toolkit_slug asc
    `).all(orgId) as Array<{ id: string; org_id: string; agent_id: string; toolkit_slug: string }>;
    return rows.map((row) => ({ id: row.id, orgId: row.org_id, agentId: row.agent_id, toolkitSlug: row.toolkit_slug }));
  }
}

export function normalizeSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) throw new Error("Toolkit slug is required.");
  return normalized;
}
