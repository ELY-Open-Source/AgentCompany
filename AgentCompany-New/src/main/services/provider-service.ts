import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { BrowserWindow, session } from "electron";
import type { CreateProviderResponseInput, SaveProviderCredentialInput, UpdateProviderPolicyInput } from "../../shared/commands";
import { FEATURE_FLAG_KEY, PROVIDER_AUTH_TYPE, PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE, PROVIDER_REQUEST_STATE, SLO_SIGNAL_KEY, type ProviderExecutionMode } from "../../shared/domain";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { OperationsService } from "./operations-service";
import { SecretVault } from "./secret-vault";
import { providerAdapters, type ProviderAdapterRegistry } from "./provider-adapters";

const AUTH_STATE_CONFIGURED = "configured";
const HEALTH_STATE_HEALTHY = "healthy";
const HEALTH_STATE_FAILED = "failed";
const HEALTH_STATE_UNCHECKED = "unchecked";
const WORKSPACE_SCOPES = new Set(["organization", "workspace"]);

function displayHint(secret: string): string {
  const clean = secret.trim();
  if (clean.length <= 10) return `${clean.slice(0, 2)}...`;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

export class ProviderService {
  private readonly audit: AuditService;
  private readonly operations: OperationsService;

  constructor(
    private readonly db: DatabaseSync,
    private readonly adapters: ProviderAdapterRegistry = providerAdapters,
    private readonly vault: SecretVault = new SecretVault(),
  ) {
    this.audit = new AuditService(db);
    this.operations = new OperationsService(db);
  }

  saveCredential(input: SaveProviderCredentialInput): void {
    const provider = this.db.prepare("select * from providers where id = ? and org_id = ?")
      .get(input.providerId, input.orgId) as { provider_key: string; auth_type: string } | undefined;
    if (!provider) throw new Error("Provider was not found.");
    const secret = input.secret.trim();
    if (!secret) throw new Error("Credential is required.");
    const adapter = this.requireAdapter(provider.provider_key, provider.auth_type);
    adapter.parseAuthProfile(secret);
    const credentialId = createId("cred");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into credentials(id, org_id, provider_key, kind, ciphertext, display_hint, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(
      credentialId,
      input.orgId,
      provider.provider_key,
      provider.auth_type,
      this.vault.encryptSecret(secret),
      displayHint(secret),
      now,
    );
    this.db.prepare(`
      update providers
      set credential_id = ?, model = ?, enabled = 1, auth_state = ?, health_state = ?, last_error = null, last_checked_at = null
      where id = ? and org_id = ?
    `).run(credentialId, input.model, AUTH_STATE_CONFIGURED, HEALTH_STATE_UNCHECKED, input.providerId, input.orgId);
    this.audit.record({
      orgId: input.orgId,
      entityType: "provider",
      entityId: input.providerId,
      actorType: "system",
      actorId: null,
      action: "credential_saved",
      payload: { providerKey: provider.provider_key, authType: provider.auth_type },
    });
  }

  async checkHealth(orgId: string, providerId: string): Promise<void> {
    const provider = this.loadConfiguredProvider(orgId, providerId);
    const adapter = this.requireAdapter(provider.provider_key, provider.auth_type);
    const credential = this.loadCredential(orgId, provider);
    try {
      const profile = adapter.parseAuthProfile(this.vault.decryptSecret(Buffer.from(credential.ciphertext)));
      await adapter.checkHealth({ authProfile: profile, model: provider.model });
      this.recordProviderHealth(provider.id, orgId, HEALTH_STATE_HEALTHY, null);
      this.audit.record({
        orgId,
        entityType: "provider",
        entityId: provider.id,
        actorType: "system",
        actorId: null,
        action: "health_checked",
        payload: { providerKey: provider.provider_key, healthState: HEALTH_STATE_HEALTHY },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordProviderHealth(provider.id, orgId, HEALTH_STATE_FAILED, message);
      throw error;
    }
  }

  launchSignInWindow(orgId: string, providerId: string): void {
    const provider = this.db.prepare(`
      select id, provider_key, label, auth_type
      from providers
      where id = ? and org_id = ?
    `).get(providerId, orgId) as { id: string; provider_key: string; label: string; auth_type: string } | undefined;
    if (!provider) throw new Error("Provider was not found.");
    const catalogEntry = PROVIDER_CATALOG.find((entry) => entry.key === provider.provider_key);
    if (!catalogEntry) throw new Error(`Provider catalog entry missing for ${provider.provider_key}.`);
    if (!catalogEntry.signInUrl) throw new Error(`${provider.label} does not support browser sign-in.`);

    const partition = `persist:agentcompany-provider-${provider.id}`;
    const providerSession = session.fromPartition(partition);
    providerSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    providerSession.setPermissionCheckHandler(() => false);

    const win = new BrowserWindow({
      width: 1100,
      height: 760,
      title: provider.label,
      webPreferences: {
        session: providerSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.attachNavigationPolicy(win, catalogEntry.signInUrl);
    win.loadURL(catalogEntry.signInUrl);

    this.audit.record({
      orgId,
      entityType: "provider",
      entityId: provider.id,
      actorType: "employee",
      actorId: null,
      action: "sign_in_window_opened",
      payload: { providerKey: provider.provider_key, authType: provider.auth_type },
    });
  }

  updatePolicy(input: UpdateProviderPolicyInput): void {
    const monthlyRequestLimit = Math.trunc(input.monthlyRequestLimit);
    if (monthlyRequestLimit < 1) throw new Error("Monthly request limit must be at least 1.");
    if (!Object.values(PROVIDER_DATA_POLICY).includes(input.dataPolicy)) throw new Error("Provider data policy is invalid.");
    if (!WORKSPACE_SCOPES.has(input.workspaceScope)) throw new Error("Provider workspace scope is invalid.");
    if (input.dataPolicy === PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION && input.backgroundEnabled) {
      throw new Error("Zero data retention policy requires foreground execution.");
    }
    const provider = this.db.prepare("select id, provider_key from providers where id = ? and org_id = ?")
      .get(input.providerId, input.orgId) as { id: string; provider_key: string } | undefined;
    if (!provider) throw new Error("Provider was not found.");

    this.db.prepare(`
      update providers
      set data_policy = ?, background_enabled = ?, monthly_request_limit = ?, workspace_scope = ?
      where id = ? and org_id = ?
    `).run(input.dataPolicy, input.backgroundEnabled ? 1 : 0, monthlyRequestLimit, input.workspaceScope, input.providerId, input.orgId);
    this.audit.record({
      orgId: input.orgId,
      entityType: "provider",
      entityId: input.providerId,
      actorType: "system",
      actorId: null,
      action: "policy_updated",
      payload: {
        providerKey: provider.provider_key,
        dataPolicy: input.dataPolicy,
        backgroundEnabled: input.backgroundEnabled,
        monthlyRequestLimit,
        workspaceScope: input.workspaceScope,
      },
    });
  }

  async createResponse(input: CreateProviderResponseInput): Promise<void> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("Prompt is required.");
    const provider = this.loadConfiguredProvider(input.orgId, input.providerId);
    const executionMode = input.executionMode ?? PROVIDER_EXECUTION_MODE.FOREGROUND;
    this.enforcePolicy(input.orgId, provider, executionMode);
    if (provider.auth_type !== PROVIDER_AUTH_TYPE.API_KEY) {
      throw new Error("Provider response execution requires an API key adapter.");
    }
    if (!provider.model) throw new Error("Provider model is required.");
    const adapter = this.requireAdapter(provider.provider_key, provider.auth_type);
    if (!adapter.createResponse) throw new Error(`Provider response execution is unavailable for ${provider.provider_key}.`);
    const credential = this.loadCredential(input.orgId, provider);

    const requestId = createId("preq");
    const now = new Date().toISOString();
    const startedAt = Date.now();
    this.db.prepare(`
      insert into provider_requests(
        id, org_id, provider_id, provider_key, model, prompt_sha256,
        response_text, raw_response_json, state, error_message, input_char_count,
        output_char_count, execution_mode, policy_decision, created_at, completed_at
      )
      values (?, ?, ?, ?, ?, ?, null, null, ?, null, ?, 0, ?, ?, ?, null)
    `).run(
      requestId,
      input.orgId,
      provider.id,
      provider.provider_key,
      provider.model,
      hashPrompt(prompt),
      PROVIDER_REQUEST_STATE.PENDING,
      prompt.length,
      executionMode,
      `allowed:${provider.data_policy}`,
      now,
    );

    try {
      const authProfile = adapter.parseAuthProfile(this.vault.decryptSecret(Buffer.from(credential.ciphertext)));
      const result = await adapter.createResponse({
        authProfile,
        model: provider.model,
        prompt,
        instructions: input.instructions?.trim() || null,
      });
      this.db.prepare(`
        update provider_requests
        set state = ?, response_text = ?, raw_response_json = ?, output_char_count = ?, completed_at = ?
        where id = ? and org_id = ?
      `).run(PROVIDER_REQUEST_STATE.SUCCEEDED, result.text, result.rawResponseJson, result.text.length, new Date().toISOString(), requestId, input.orgId);
      this.recordUsage(input.orgId, provider.id, prompt.length, result.text.length);
      this.recordProviderHealth(provider.id, input.orgId, HEALTH_STATE_HEALTHY, null);
      this.audit.record({
        orgId: input.orgId,
        entityType: "provider_request",
        entityId: requestId,
        actorType: "system",
        actorId: null,
        action: "response_created",
        payload: { providerKey: provider.provider_key, model: provider.model },
      });
      this.operations.recordSignal({
        orgId: input.orgId,
        signalKey: SLO_SIGNAL_KEY.PROVIDER_REQUEST_SUCCESS,
        source: "provider_gateway",
        success: true,
        durationMs: Date.now() - startedAt,
        detail: { requestId, providerKey: provider.provider_key, executionMode },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.prepare(`
        update provider_requests
        set state = ?, error_message = ?, completed_at = ?
        where id = ? and org_id = ?
      `).run(PROVIDER_REQUEST_STATE.FAILED, message, new Date().toISOString(), requestId, input.orgId);
      this.recordUsage(input.orgId, provider.id, prompt.length, 0);
      this.recordProviderHealth(provider.id, input.orgId, HEALTH_STATE_FAILED, message);
      this.operations.recordSignal({
        orgId: input.orgId,
        signalKey: SLO_SIGNAL_KEY.PROVIDER_REQUEST_SUCCESS,
        source: "provider_gateway",
        success: false,
        durationMs: Date.now() - startedAt,
        detail: { requestId, providerKey: provider.provider_key, executionMode },
      });
      throw error;
    }
  }

  private enforcePolicy(orgId: string, provider: ProviderRow, executionMode: ProviderExecutionMode): void {
    if (!Object.values(PROVIDER_EXECUTION_MODE).includes(executionMode)) throw new Error("Provider execution mode is invalid.");
    if (executionMode === PROVIDER_EXECUTION_MODE.BACKGROUND && provider.data_policy === PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION) {
      throw new Error("Background execution conflicts with zero data retention policy.");
    }
    if (executionMode === PROVIDER_EXECUTION_MODE.BACKGROUND && !this.operations.isFeatureEnabled(orgId, FEATURE_FLAG_KEY.PROVIDER_BACKGROUND_EXECUTION)) {
      throw new Error("Provider background execution is disabled by feature flag.");
    }
    if (executionMode === PROVIDER_EXECUTION_MODE.BACKGROUND && provider.background_enabled !== 1) {
      throw new Error("Background execution is disabled for this provider policy.");
    }
    const window = currentMonthlyWindow();
    const usage = this.db.prepare(`
      select request_count
      from provider_usage_windows
      where org_id = ? and provider_id = ? and window_start = ?
    `).get(orgId, provider.id, window.start) as { request_count: number } | undefined;
    const requestCount = usage?.request_count ?? 0;
    if (requestCount >= provider.monthly_request_limit) throw new Error("Provider monthly request limit has been reached.");
  }

  private loadConfiguredProvider(orgId: string, providerId: string): ProviderRow {
    const provider = this.db.prepare(`
      select id, provider_key, auth_type, model, credential_id, enabled, auth_state,
        data_policy, background_enabled, monthly_request_limit, workspace_scope
      from providers
      where id = ? and org_id = ?
    `).get(providerId, orgId) as ProviderRow | undefined;
    if (!provider) throw new Error("Provider was not found.");
    if (provider.enabled !== 1 || provider.auth_state !== AUTH_STATE_CONFIGURED) throw new Error("Provider credential is required.");
    if (!provider.credential_id) throw new Error("Provider credential is required.");
    return provider;
  }

  private loadCredential(orgId: string, provider: ProviderRow): { ciphertext: Uint8Array } {
    if (!provider.credential_id) throw new Error("Provider credential is required.");
    const credential = this.db.prepare(`
      select ciphertext
      from credentials
      where id = ? and org_id = ? and provider_key = ?
    `).get(provider.credential_id, orgId, provider.provider_key) as { ciphertext: Uint8Array } | undefined;
    if (!credential) throw new Error("Provider credential was not found.");
    return credential;
  }

  private requireAdapter(providerKey: string, authType: string): ProviderAdapterRegistry[string] {
    const adapter = this.adapters[providerKey];
    if (!adapter) throw new Error(`Provider adapter is unavailable for ${providerKey}.`);
    if (adapter.authType !== authType) throw new Error(`Provider adapter auth type mismatch for ${providerKey}.`);
    return adapter;
  }

  private attachNavigationPolicy(win: BrowserWindow, signInUrl: string): void {
    const allowedHost = new URL(signInUrl).hostname.toLowerCase();
    const allow = (url: string) => {
      const host = new URL(url).hostname.toLowerCase();
      return host === allowedHost || host.endsWith(`.${allowedHost}`);
    };
    const blockOffHost = (event: Electron.Event, url: string) => {
      if (!allow(url)) event.preventDefault();
    };
    win.webContents.on("will-navigate", blockOffHost);
    win.webContents.on("will-redirect", blockOffHost);
  }

  private recordProviderHealth(providerId: string, orgId: string, healthState: string, error: string | null): void {
    this.db.prepare(`
      update providers
      set health_state = ?, last_error = ?, last_checked_at = ?
      where id = ? and org_id = ?
    `).run(healthState, error, new Date().toISOString(), providerId, orgId);
  }

  private recordUsage(orgId: string, providerId: string, inputCharCount: number, outputCharCount: number): void {
    const window = currentMonthlyWindow();
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into provider_usage_windows(
        id, org_id, provider_id, window_start, window_end, request_count,
        input_char_count, output_char_count, created_at, updated_at
      ) values (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      on conflict(provider_id, window_start) do update set
        request_count = request_count + 1,
        input_char_count = input_char_count + excluded.input_char_count,
        output_char_count = output_char_count + excluded.output_char_count,
        updated_at = excluded.updated_at
    `).run(createId("puw"), orgId, providerId, window.start, window.end, inputCharCount, outputCharCount, now, now);
  }
}

interface ProviderRow {
  id: string;
  provider_key: string;
  auth_type: string;
  model: string | null;
  credential_id: string | null;
  enabled: number;
  auth_state: string;
  data_policy: string;
  background_enabled: number;
  monthly_request_limit: number;
  workspace_scope: string;
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

function currentMonthlyWindow(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}
