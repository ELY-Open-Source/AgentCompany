import type { DatabaseSync } from "node:sqlite";
import type { ConnectorCatalogEntry, ConnectComposioToolkitResult } from "../../../shared/commands";
import { ComposioClient } from "./composio-client";
import { composioApiKey } from "./composio-credentials";
import { getComposioUserId } from "./composio-tool-bridge";
import { connectorDisplayName, connectorLogoUrl } from "./connector-brands";
import { normalizeSlug } from "./connector-grants";

const CATALOG_TTL_MS = 10 * 60 * 1000;

let catalogCache: { fetchedAt: number; entries: ConnectorCatalogEntry[] } | null = null;

/**
 * Company-level Composio connections. The catalog mirrors the auth configs
 * of the Composio project — the dashboard is the source of truth for which
 * connectors exist; the app never creates auth configs, it only connects
 * accounts against them. One connected account per toolkit per organization,
 * mirrored into connector_accounts so agent runs and the Connectors page
 * read local state instead of calling out on every frame.
 */
export class ComposioConnectionService {
  constructor(private readonly db: DatabaseSync) {}

  listCatalog(): Promise<ConnectorCatalogEntry[]> {
    return this.catalog(this.requireClient());
  }

  /**
   * Starts (or restarts) the company's connection for a toolkit: initiates a
   * connected account against the toolkit's configured auth config via the
   * link flow and records the pending account locally as INITIALIZING — the
   * poll that follows adopts Composio's real status. The returned redirect
   * URL completes authorization (or API-key entry) in the browser.
   */
  async connectToolkit(orgId: string, toolkitSlug: string): Promise<ConnectComposioToolkitResult> {
    const slug = normalizeSlug(toolkitSlug);
    const client = this.requireClient();
    const entry = (await this.catalog(client)).find((item) => item.slug === slug);
    if (!entry) throw new Error(`No auth config for "${slug}" exists in the Composio project.`);
    const account = await client.createConnectedAccount({
      authConfigId: entry.authConfigId,
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
    `).run(account.id, orgId, slug, entry.name, entry.authConfigId, "INITIALIZING", now, now);
    return { accountId: account.id, redirectUrl: account.redirectUrl };
  }

  /** Pulls account statuses from Composio and updates the local mirror. */
  async refreshAccounts(orgId: string): Promise<void> {
    const client = this.requireClient();
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
        connectorDisplayName(account.toolkitSlug),
        account.authConfigId,
        account.status,
        account.createdAt || now,
        now,
      );
    }
  }

  private requireClient(): ComposioClient {
    const apiKey = composioApiKey();
    if (!apiKey) throw new Error("The Composio integration is not configured in this build.");
    return new ComposioClient(apiKey);
  }

  private async catalog(client: ComposioClient): Promise<ConnectorCatalogEntry[]> {
    if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
      return catalogCache.entries;
    }
    const configs = await client.listAuthConfigs();
    const bySlug = new Map<string, ConnectorCatalogEntry>();
    for (const config of configs) {
      if (config.status !== "ENABLED" || !config.toolkitSlug || bySlug.has(config.toolkitSlug)) continue;
      bySlug.set(config.toolkitSlug, {
        authConfigId: config.id,
        slug: config.toolkitSlug,
        name: connectorDisplayName(config.toolkitSlug),
        authScheme: config.authScheme,
        logoUrl: connectorLogoUrl(config.toolkitSlug),
      });
    }
    const entries = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
    catalogCache = { fetchedAt: Date.now(), entries };
    return entries;
  }
}
