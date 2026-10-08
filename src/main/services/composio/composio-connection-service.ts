import type { DatabaseSync } from "node:sqlite";
import type { ConnectorCatalogEntry, ConnectComposioToolkitResult } from "../../../shared/commands";
import { ComposioClient, type ComposioConnectedAccount } from "./composio-client";
import { IntegrationKeyStore } from "../integration-key-store";
import { getComposioUserId } from "./composio-tool-bridge";
import { connectorDisplayName, connectorLogoUrl } from "./connector-brands";
import { DEFAULT_ACCOUNT_LABEL, normalizeAccountLabel, normalizeSlug } from "./connector-grants";

const CATALOG_TTL_MS = 10 * 60 * 1000;
const WAITING_STATUSES = new Set(["INITIALIZING", "INITIATED"]);

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

  /** Starts a toolkit account's connection; a reconnect waits beside an active account until refresh finds it authorized. */
  connectToolkit(orgId: string, toolkitSlug: string, label: string): Promise<ConnectComposioToolkitResult> {
    return this.serialize(orgId, () => this.connectToolkitNow(orgId, toolkitSlug, label));
  }

  /** See class docs: linearizes connect/refresh/disconnect for one org. */
  private serialize<T>(orgId: string, operation: () => Promise<T>): Promise<T> {
    const tail = ComposioConnectionService.queues.get(orgId) ?? Promise.resolve();
    const next = tail.then(operation, operation);
    ComposioConnectionService.queues.set(orgId, next.then(() => undefined, () => undefined));
    return next;
  }

  private async connectToolkitNow(orgId: string, toolkitSlug: string, rawLabel: string): Promise<ConnectComposioToolkitResult> {
    const slug = normalizeSlug(toolkitSlug);
    const label = normalizeAccountLabel(rawLabel);
    const client = this.requireClient();
    const entry = (await this.catalog(client)).find((item) => item.slug === slug);
    if (!entry) throw new Error(`No auth config for "${slug}" exists in the Composio project.`);
    const previous = this.db.prepare(
      "select id, status, pending_account_id from connector_accounts where org_id = ? and toolkit_slug = ? and label = ?",
    ).get(orgId, slug, label) as { id: string; status: string; pending_account_id: string | null } | undefined;
    const account = await client.createConnectedAccount({
      authConfigId: entry.authConfigId,
      userId: getComposioUserId(this.db, orgId),
    });
    if (!account.id) throw new Error("Composio did not return a connected account id.");
    const now = new Date().toISOString();
    // The local row moves to the new account before any old one is deleted; refresh ignores accounts no row tracks.
    if (previous?.status === "ACTIVE") {
      this.db.prepare("update connector_accounts set pending_account_id = ?, updated_at = ? where id = ?").run(account.id, now, previous.id);
      console.info(`[connectors] ${slug}/${label} reconnect ${account.id} started; ${previous.id} stays in use until it is authorized`);
      if (previous.pending_account_id) await client.deleteConnectedAccount(previous.pending_account_id);
      return { accountId: account.id, redirectUrl: account.redirectUrl };
    }
    this.db.prepare(`
      insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, label, auth_config_id, status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(org_id, toolkit_slug, label) do update set
        id = excluded.id,
        toolkit_name = excluded.toolkit_name,
        auth_config_id = excluded.auth_config_id,
        status = excluded.status,
        pending_account_id = null,
        updated_at = excluded.updated_at
    `).run(account.id, orgId, slug, entry.name, label, entry.authConfigId, "INITIALIZING", now, now);
    if (previous?.pending_account_id) await client.deleteConnectedAccount(previous.pending_account_id);
    if (previous) await client.deleteConnectedAccount(previous.id);
    return { accountId: account.id, redirectUrl: account.redirectUrl };
  }

  /** Mirrors Composio: tracked accounts take its status, gone ones are removed with their grants, toolkits with no account here are adopted. */
  refreshAccounts(orgId: string): Promise<void> {
    return this.serialize(orgId, () => this.refreshAccountsNow(orgId));
  }

  private async refreshAccountsNow(orgId: string): Promise<void> {
    const client = this.requireClient();
    const accounts = await client.listConnectedAccounts(getComposioUserId(this.db, orgId));
    const now = new Date().toISOString();
    const liveIds = new Set(accounts.map((account) => account.id));
    const reconnects = this.db.prepare("select id, toolkit_slug, pending_account_id from connector_accounts where org_id = ? and pending_account_id is not null")
      .all(orgId) as Array<{ id: string; toolkit_slug: string; pending_account_id: string }>;
    for (const row of reconnects) await this.settleReconnect(client, row, accounts.find((account) => account.id === row.pending_account_id), liveIds.has(row.id));
    const localRows = this.db.prepare("select id, toolkit_slug, label from connector_accounts where org_id = ?")
      .all(orgId) as Array<{ id: string; toolkit_slug: string; label: string }>;
    for (const row of localRows) {
      if (!liveIds.has(row.id)) this.removeLocalAccount(orgId, row.toolkit_slug, row.label);
    }
    const tracked = this.trackedIds(orgId);
    const toolkitsHere = new Set(localRows.filter((row) => liveIds.has(row.id)).map((row) => row.toolkit_slug));
    for (const account of accounts) {
      if (!account.toolkitSlug) continue;
      if (tracked.has(account.id)) {
        this.db.prepare("update connector_accounts set auth_config_id = ?, status = ?, updated_at = ? where id = ?")
          .run(account.authConfigId, account.status, now, account.id);
        continue;
      }
      // Only a toolkit with no account here is adopted; other untracked accounts (a waiting reconnect, an orphan) never join.
      if (toolkitsHere.has(account.toolkitSlug)) continue;
      toolkitsHere.add(account.toolkitSlug);
      this.db.prepare(`
        insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, label, auth_config_id, status, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(account.id, orgId, account.toolkitSlug, connectorDisplayName(account.toolkitSlug), DEFAULT_ACCOUNT_LABEL, account.authConfigId, account.status, account.createdAt || now, now);
    }
  }

  /** A waiting reconnect replaces the old account once active (or once the old one is gone); one that failed or vanished is dropped and the old account stays. */
  private async settleReconnect(
    client: ComposioClient,
    row: { id: string; toolkit_slug: string; pending_account_id: string },
    pending: ComposioConnectedAccount | undefined,
    oldIsLive: boolean,
  ): Promise<void> {
    const now = new Date().toISOString();
    if (pending && (pending.status === "ACTIVE" || !oldIsLive)) {
      if (oldIsLive) await client.deleteConnectedAccount(row.id);
      this.db.prepare("update connector_accounts set id = ?, auth_config_id = ?, status = ?, pending_account_id = null, updated_at = ? where id = ?")
        .run(pending.id, pending.authConfigId, pending.status, now, row.id);
      console.info(`[connectors] ${row.toolkit_slug} reconnect ${pending.id} replaced ${row.id}`);
      return;
    }
    if (pending && WAITING_STATUSES.has(pending.status)) return;
    if (pending) await client.deleteConnectedAccount(pending.id);
    this.db.prepare("update connector_accounts set pending_account_id = null, updated_at = ? where id = ?").run(now, row.id);
    console.warn(`[connectors] ${row.toolkit_slug} reconnect ${row.pending_account_id} ended ${pending?.status ?? "missing"}; ${row.id} stays in use`);
  }

  /** Deletes one account of a toolkit in Composio, with untracked leftovers of that toolkit, then its row and the grants that named it. */
  disconnectToolkit(orgId: string, toolkitSlug: string, label: string): Promise<void> {
    return this.serialize(orgId, () => this.disconnectToolkitNow(orgId, toolkitSlug, label));
  }

  private async disconnectToolkitNow(orgId: string, toolkitSlug: string, rawLabel: string): Promise<void> {
    const slug = normalizeSlug(toolkitSlug);
    const label = normalizeAccountLabel(rawLabel);
    const row = this.db.prepare(
      "select id, pending_account_id from connector_accounts where org_id = ? and toolkit_slug = ? and label = ?",
    ).get(orgId, slug, label) as { id: string; pending_account_id: string | null } | undefined;
    if (!row) return;
    const client = this.requireClient();
    // Untracked accounts of the toolkit go too, so an orphan from a failed delete cannot be adopted later.
    const tracked = this.trackedIds(orgId);
    const ids = new Set([row.id, ...(row.pending_account_id ? [row.pending_account_id] : [])]);
    for (const account of await client.listConnectedAccounts(getComposioUserId(this.db, orgId))) {
      if (account.toolkitSlug === slug && !tracked.has(account.id)) ids.add(account.id);
    }
    for (const id of ids) await client.deleteConnectedAccount(id);
    this.removeLocalAccount(orgId, slug, label);
  }

  /** Every Composio account a row here stands for, waiting reconnects included. */
  private trackedIds(orgId: string): Set<string> {
    const rows = this.db.prepare("select id, pending_account_id from connector_accounts where org_id = ?")
      .all(orgId) as Array<{ id: string; pending_account_id: string | null }>;
    return new Set(rows.flatMap((row) => (row.pending_account_id ? [row.id, row.pending_account_id] : [row.id])));
  }

  private removeLocalAccount(orgId: string, slug: string, label: string): void {
    this.db.prepare("delete from connector_accounts where org_id = ? and toolkit_slug = ? and label = ?").run(orgId, slug, label);
    this.db.prepare("delete from agent_connector_grants where org_id = ? and toolkit_slug = ? and account_label = ?").run(orgId, slug, label);
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
