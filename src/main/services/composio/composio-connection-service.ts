import type { DatabaseSync } from "node:sqlite";
import type { ConnectorCatalogEntry, ConnectComposioToolkitResult } from "../../../shared/commands";
import { ComposioClient } from "./composio-client";
import { IntegrationKeyStore } from "../integration-key-store";
import { getComposioUserId } from "./composio-tool-bridge";
import { connectorDisplayName, connectorLogoUrl } from "./connector-brands";
import { normalizeSlug } from "./connector-grants";

const CATALOG_TTL_MS = 10 * 60 * 1000;

let catalogCache: { fetchedAt: number; keys: string; entries: ConnectorCatalogEntry[] } | null = null;

/**
 * Company-level Composio connections. The catalog mirrors the auth configs
 * of the Composio project — the dashboard is the source of truth for which
 * connectors exist; the app never creates auth configs, it only connects
 * accounts against them. One connected account per toolkit per organization,
 * mirrored into connector_accounts so agent runs and the Connectors page
 * read local state instead of calling out on every frame.
 *
 * Mutations and refreshes are serialized per organization: a refresh whose
 * server read predates a delete or connect would otherwise land afterwards
 * and resurrect (or sweep) rows from its stale snapshot.
 */
export class ComposioConnectionService {
  private static queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly keys: IntegrationKeyStore = new IntegrationKeyStore(db),
  ) {}

  listCatalog(): Promise<ConnectorCatalogEntry[]> {
    return this.catalog(this.requireClient());
  }

  /**
   * Starts (or restarts) the company's connection for a toolkit: initiates a
   * connected account against the toolkit's configured auth config via the
   * link flow and records the pending account locally as INITIALIZING — the
   * poll that follows adopts Composio's real status. Any previous account
   * for the toolkit is deleted first so reconnecting replaces instead of
   * accumulating accounts in Composio. The returned redirect URL completes
   * authorization (or API-key entry) in the browser.
   */
  connectToolkit(orgId: string, toolkitSlug: string): Promise<ConnectComposioToolkitResult> {
    return this.serialize(orgId, () => this.connectToolkitNow(orgId, toolkitSlug));
  }

  /** See class docs: linearizes connect/refresh/disconnect for one org. */
  private serialize<T>(orgId: string, operation: () => Promise<T>): Promise<T> {
    const tail = ComposioConnectionService.queues.get(orgId) ?? Promise.resolve();
    const next = tail.then(operation, operation);
    ComposioConnectionService.queues.set(orgId, next.then(() => undefined, () => undefined));
    return next;
  }

  private async connectToolkitNow(orgId: string, toolkitSlug: string): Promise<ConnectComposioToolkitResult> {
    const slug = normalizeSlug(toolkitSlug);
    const client = this.requireClient();
    const entry = (await this.catalog(client)).find((item) => item.slug === slug);
    if (!entry) throw new Error(`No auth config for "${slug}" exists in the Composio project.`);
    const previous = this.db.prepare(
      "select id from connector_accounts where org_id = ? and toolkit_slug = ?",
    ).get(orgId, slug) as { id: string } | undefined;
    if (previous) await client.deleteConnectedAccount(previous.id);
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

  /**
   * Pulls account statuses from Composio and updates the local mirror, in
   * both directions: statuses adopt Composio's truth, and local rows whose
   * account no longer exists in Composio are removed along with their
   * grants — deleting an account in the dashboard cleans up here too.
   */
  refreshAccounts(orgId: string): Promise<void> {
    return this.serialize(orgId, () => this.refreshAccountsNow(orgId));
  }

  private async refreshAccountsNow(orgId: string): Promise<void> {
    const client = this.requireClient();
    const accounts = await client.listConnectedAccounts(getComposioUserId(this.db, orgId));
    const now = new Date().toISOString();
    const liveIds = new Set(accounts.map((account) => account.id));
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
    const localRows = this.db.prepare("select id, toolkit_slug from connector_accounts where org_id = ?")
      .all(orgId) as Array<{ id: string; toolkit_slug: string }>;
    for (const row of localRows) {
      if (liveIds.has(row.id)) continue;
      this.removeLocalAccount(orgId, row.toolkit_slug);
    }
  }

  /**
   * Deletes the company's connection for a toolkit: removes the connected
   * account in Composio (already-gone counts as deleted), then the local
   * mirror row and every agent grant that pointed at it.
   */
  disconnectToolkit(orgId: string, toolkitSlug: string): Promise<void> {
    return this.serialize(orgId, () => this.disconnectToolkitNow(orgId, toolkitSlug));
  }

  private async disconnectToolkitNow(orgId: string, toolkitSlug: string): Promise<void> {
    const slug = normalizeSlug(toolkitSlug);
    const row = this.db.prepare(
      "select id from connector_accounts where org_id = ? and toolkit_slug = ?",
    ).get(orgId, slug) as { id: string } | undefined;
    if (!row) return;
    await this.requireClient().deleteConnectedAccount(row.id);
    this.removeLocalAccount(orgId, slug);
  }

  private removeLocalAccount(orgId: string, slug: string): void {
    this.db.prepare("delete from connector_accounts where org_id = ? and toolkit_slug = ?").run(orgId, slug);
    this.db.prepare("delete from agent_connector_grants where org_id = ? and toolkit_slug = ?").run(orgId, slug);
  }

  private requireClient(): ComposioClient {
    const apiKey = this.keys.read("composio");
    if (!apiKey) throw new Error("No Composio API key is saved. Add one in Settings > Integrations.");
    return new ComposioClient(apiKey);
  }

  private async catalog(client: ComposioClient): Promise<ConnectorCatalogEntry[]> {
    const logoDevToken = this.keys.read("logo_dev");
    const keys = `${this.keys.read("composio")}
${logoDevToken}`;
    if (catalogCache && catalogCache.keys === keys && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
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
        logoUrl: connectorLogoUrl(config.toolkitSlug, logoDevToken),
      });
    }
    const entries = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
    catalogCache = { fetchedAt: Date.now(), keys, entries };
    return entries;
  }
}
