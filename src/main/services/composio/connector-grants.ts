import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_CONNECTOR_ACCOUNT_LABEL } from "../../../shared/commands/composio";
import { createId } from "../../../shared/ids";

export const DEFAULT_ACCOUNT_LABEL = DEFAULT_CONNECTOR_ACCOUNT_LABEL;
const MAX_LABEL_CHARS = 40;

export interface ConnectorAccountRow {
  id: string;
  orgId: string;
  toolkitSlug: string;
  toolkitName: string;
  label: string;
  status: string;
}

export interface ConnectorGrantRow {
  id: string;
  orgId: string;
  agentId: string;
  toolkitSlug: string;
  accountLabel: string;
}

/** Which agents may use which labelled company accounts: the CEO all active ones by role, others one per toolkit by grant. */
export class ConnectorGrantsService {
  constructor(private readonly db: DatabaseSync) {}

  grant(input: { orgId: string; agentId: string; toolkitSlug: string; accountLabel: string | null; grantedByType: "agent" | "employee"; grantedById: string | null }): string {
    const agent = this.db.prepare("select id from agents where id = ? and org_id = ? and lifecycle = 'active'")
      .get(input.agentId, input.orgId);
    if (!agent) throw new Error("Grant target must be an active agent in this organization.");
    const slug = normalizeSlug(input.toolkitSlug);
    const label = this.chooseAccount(input.orgId, slug, input.accountLabel).label;
    this.db.prepare(`
      insert into agent_connector_grants(id, org_id, agent_id, toolkit_slug, account_label, granted_by_type, granted_by_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(org_id, agent_id, toolkit_slug) do update set
        account_label = excluded.account_label,
        granted_by_type = excluded.granted_by_type,
        granted_by_id = excluded.granted_by_id
    `).run(createId("cgr"), input.orgId, input.agentId, slug, label, input.grantedByType, input.grantedById, new Date().toISOString());
    return label;
  }

  revoke(input: { orgId: string; agentId: string; toolkitSlug: string }): void {
    this.db.prepare("delete from agent_connector_grants where org_id = ? and agent_id = ? and toolkit_slug = ?")
      .run(input.orgId, input.agentId, normalizeSlug(input.toolkitSlug));
  }

  /** Toolkits this agent may use: every active one for the CEO; for others, those whose granted account is active. */
  toolkitsForAgent(orgId: string, agentId: string): string[] {
    if (this.isCeo(orgId, agentId)) {
      return [...new Set(this.activeAccounts(orgId).map((account) => account.toolkitSlug))];
    }
    const rows = this.db.prepare(`
      select g.toolkit_slug as slug
      from agent_connector_grants g
      join connector_accounts a on a.org_id = g.org_id and a.toolkit_slug = g.toolkit_slug and a.label = g.account_label and a.status = 'ACTIVE'
      where g.org_id = ? and g.agent_id = ?
      order by g.toolkit_slug asc
    `).all(orgId, agentId) as Array<{ slug: string }>;
    return rows.map((row) => row.slug);
  }

  /** The active account this agent acts through for a toolkit; the CEO names one when the toolkit has several. */
  accountForAgent(orgId: string, agentId: string, toolkitSlug: string, accountLabel: string | null): ConnectorAccountRow {
    const slug = normalizeSlug(toolkitSlug);
    if (this.isCeo(orgId, agentId)) return this.chooseAccount(orgId, slug, accountLabel);
    const grant = this.db.prepare("select account_label from agent_connector_grants where org_id = ? and agent_id = ? and toolkit_slug = ?")
      .get(orgId, agentId, slug) as { account_label: string } | undefined;
    if (!grant) throw new Error(`You have no grant for the "${slug}" connector. Ask the CEO to grant it to you (grant_connector).`);
    if (accountLabel !== null && normalizeAccountLabel(accountLabel) !== grant.account_label) {
      throw new Error(`Your grant for "${slug}" is the "${grant.account_label}" account, not "${accountLabel}".`);
    }
    const account = this.activeAccounts(orgId).find((row) => row.toolkitSlug === slug && row.label === grant.account_label);
    if (!account) throw new Error(`The "${slug}" account "${grant.account_label}" is no longer connected. Ask the board to reconnect it on the Connectors page.`);
    return account;
  }

  activeAccounts(orgId: string): ConnectorAccountRow[] {
    const rows = this.db.prepare(`
      select id, org_id, toolkit_slug, toolkit_name, label, status
      from connector_accounts
      where org_id = ? and status = 'ACTIVE'
      order by toolkit_slug asc, label asc
    `).all(orgId) as Array<{ id: string; org_id: string; toolkit_slug: string; toolkit_name: string; label: string; status: string }>;
    return rows.map((row) => ({
      id: row.id,
      orgId: row.org_id,
      toolkitSlug: row.toolkit_slug,
      toolkitName: row.toolkit_name,
      label: row.label,
      status: row.status,
    }));
  }

  grantsForOrg(orgId: string): ConnectorGrantRow[] {
    const rows = this.db.prepare(`
      select id, org_id, agent_id, toolkit_slug, account_label
      from agent_connector_grants
      where org_id = ?
      order by toolkit_slug asc
    `).all(orgId) as Array<{ id: string; org_id: string; agent_id: string; toolkit_slug: string; account_label: string }>;
    return rows.map((row) => ({ id: row.id, orgId: row.org_id, agentId: row.agent_id, toolkitSlug: row.toolkit_slug, accountLabel: row.account_label }));
  }

  /** The named active account of a toolkit, or its only one; several accounts with no name is an error that lists them. */
  private chooseAccount(orgId: string, slug: string, accountLabel: string | null): ConnectorAccountRow {
    const accounts = this.activeAccounts(orgId).filter((account) => account.toolkitSlug === slug);
    if (accounts.length === 0) throw new Error(`No active connection for toolkit "${slug}". Connect it on the Connectors page first.`);
    const labels = accounts.map((account) => account.label).join(", ");
    if (accountLabel === null) {
      if (accounts.length > 1) throw new Error(`"${slug}" has several accounts (${labels}); name one with account.`);
      return accounts[0];
    }
    const label = normalizeAccountLabel(accountLabel);
    const account = accounts.find((row) => row.label === label);
    if (!account) throw new Error(`"${slug}" has no active account "${label}"; its accounts: ${labels}.`);
    return account;
  }

  private isCeo(orgId: string, agentId: string): boolean {
    const acting = this.db.prepare("select role_level from agents where id = ? and org_id = ?")
      .get(agentId, orgId) as { role_level: string } | undefined;
    return acting?.role_level === "c_suite";
  }
}

export function normalizeSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) throw new Error("Toolkit slug is required.");
  return normalized;
}

/** Account labels are trimmed and lower-case so "Sales" and "sales " name the same account. */
export function normalizeAccountLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (!normalized) throw new Error("Account label is required.");
  if (normalized.length > MAX_LABEL_CHARS) throw new Error(`Account label must be at most ${MAX_LABEL_CHARS} characters.`);
  return normalized;
}
