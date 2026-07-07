import type { DatabaseSync } from "node:sqlite";
import type { ComposioToolkitSummaryDto, ConnectComposioToolkitResult } from "../../../shared/commands";
import { ComposioClient, type ComposioToolkitSummary } from "./composio-client";
import { resolveComposioApiKey } from "./composio-credentials";
import { getComposioUserId } from "./composio-tool-bridge";
import { normalizeSlug } from "./connector-grants";

const TOOLKIT_CATALOG_LIMIT = 200;
const CATALOG_TTL_MS = 10 * 60 * 1000;

let catalogCache: { fetchedAt: number; toolkits: ComposioToolkitSummary[] } | null = null;

/**
 * Company-level Composio connections. One connected account per toolkit per
 * organization, mirrored into connector_accounts so agent runs and the
 * Connectors page read local state instead of calling out on every frame.
 */
export class ComposioConnectionService {
  constructor(private readonly db: DatabaseSync, private readonly credentialFileDir: string) {}

  listToolkits(orgId: string): Promise<ComposioToolkitSummaryDto[]> {
    const client = this.requireClient(orgId);
    return this.catalog(client);
  }

  /**
   * Starts (or restarts) the company's connection for a toolkit: creates a
   * Composio-managed auth config once per toolkit, initiates the connected
   * account for the company user, and records the pending account locally.
   * The returned redirect URL completes authorization in the browser.
   */
  async connectToolkit(orgId: string, toolkitSlug: string, toolkitName: string): Promise<ConnectComposioToolkitResult> {
    const slug = normalizeSlug(toolkitSlug);
    const client = this.requireClient(orgId);
    const authConfigId = await this.ensureAuthConfig(client, orgId, slug);
    const account = await client.createConnectedAccount({
      authConfigId,
      userId: getComposioUserId(this.db, orgId),
    });
    if (!account.id) throw new Error("Composio did not return a connected account id.");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, auth_config_id, status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(org_id, toolkit_slug) do update set
        id = excluded.id,
        toolkit_name = excluded.toolkit_name,
        auth_config_id = excluded.auth_config_id,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(account.id, orgId, slug, toolkitName.trim() || slug, authConfigId, account.status || "INITIATED", now, now);
    return { accountId: account.id, status: account.status, redirectUrl: account.redirectUrl };
  }

  /** Pulls account statuses from Composio and updates the local mirror. */
  async refreshAccounts(orgId: string): Promise<void> {
    const client = this.requireClient(orgId);
    const accounts = await client.listConnectedAccounts(getComposioUserId(this.db, orgId));
    const now = new Date().toISOString();
    for (const account of accounts) {
      if (!account.toolkitSlug) continue;
      this.db.prepare(`
        insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, auth_config_id, status, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(org_id, toolkit_slug) do update set
          id = excluded.id,
          auth_config_id = excluded.auth_config_id,
          status = excluded.status,
          updated_at = excluded.updated_at
      `).run(
        account.id,
        orgId,
        account.toolkitSlug,
        account.toolkitSlug,
        account.authConfigId,
        account.status,
        account.createdAt || now,
        now,
      );
    }
  }

  private requireClient(orgId: string): ComposioClient {
    const apiKey = resolveComposioApiKey(this.db, orgId, this.credentialFileDir);
    if (!apiKey) throw new Error("Composio API key is not configured for this company.");
    return new ComposioClient(apiKey);
  }

  private async ensureAuthConfig(client: ComposioClient, orgId: string, slug: string): Promise<string> {
    const key = `auth_config:${slug}`;
    const existing = this.db.prepare(
      "select value from composio_settings where org_id = ? and key = ? limit 1",
    ).get(orgId, key) as { value: string } | undefined;
    if (existing?.value) return existing.value;
    const authConfigId = await client.createAuthConfig(slug);
    this.db.prepare(`
      insert into composio_settings(org_id, key, value, updated_at) values (?, ?, ?, ?)
      on conflict(org_id, key) do update set value = excluded.value, updated_at = excluded.updated_at
    `).run(orgId, key, authConfigId, new Date().toISOString());
    return authConfigId;
  }

  private async catalog(client: ComposioClient): Promise<ComposioToolkitSummaryDto[]> {
    if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
      return catalogCache.toolkits;
    }
    const toolkits = await client.listToolkits(TOOLKIT_CATALOG_LIMIT);
    catalogCache = { fetchedAt: Date.now(), toolkits };
    return toolkits;
  }

}
