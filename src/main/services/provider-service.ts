import type { DatabaseSync } from "node:sqlite";
import type { CancelProviderResponseInput, ListProviderModelsInput, RevokeProviderCredentialInput, SaveProviderCredentialInput, StreamProviderResponseInput, UpdateProviderPolicyInput, SetProviderPricesInput } from "../../shared/commands";
import type { ProviderModelEntry } from "../../shared/provider-models";
import { PROVIDER_AUTH_TYPE, PROVIDER_DATA_POLICY, type ProviderAuthType } from "../../shared/domain";
import type { ProviderStreamRendererEvent } from "../../shared/provider-request-domain";
import { AuditService } from "./audit-service";
import { AuthBrokerService, type ProviderSecretVault } from "./auth-broker-service";
import { OperationsService } from "./operations-service";
import { IntegrationKeyStore } from "./integration-key-store";
import { SecretVault } from "./secret-vault";
import { providerAdapters, type ProviderAdapterRegistry } from "./provider-adapters";
import { ProviderBackgroundService } from "./provider-background-service";
import { ProviderRateLimitRegistry } from "./provider-rate-limit-registry";
import { ProviderResponseObserver } from "./provider-response-observer";
import { ProviderRequestStore } from "./provider-request-store";
import { ProviderResponseRunner, type ProviderResponseCreateInput } from "./provider-response-runner";
import type { ToolTurnFn } from "./provider-tool-turn";
import { stopRun } from "./run-control";
import type { ModelCheckResult } from "../../shared/desktop-api";
import {
  AUTH_STATE_CONFIGURED,
  AUTH_STATE_REVOKED,
  HEALTH_STATE_FAILED,
  HEALTH_STATE_HEALTHY,
  HEALTH_STATE_UNCHECKED,
  WORKSPACE_SCOPES,
  loadConfiguredProvider,
  loadCredential,
  recordProviderHealth,
  requireAdapter,
  requireCatalogEntry,
} from "./provider-internal";

export type { ProviderResponseCreateInput };

/** Room for instructions, the output reserve, and some history. */
const MIN_CONTEXT_WINDOW_TOKENS = 24_000;

export class ProviderService {
  private readonly audit: AuditService;
  private readonly authBroker: AuthBrokerService;
  private readonly operations: OperationsService;
  private readonly rateLimitRegistry: ProviderRateLimitRegistry;
  private readonly responseObserver: ProviderResponseObserver;
  private readonly requestStore: ProviderRequestStore;
  private readonly background: ProviderBackgroundService;
  private readonly runner: ProviderResponseRunner;
  readonly integrationKeys: IntegrationKeyStore;

  constructor(
    private readonly db: DatabaseSync,
    private readonly adapters: ProviderAdapterRegistry = providerAdapters,
    vault: ProviderSecretVault = new SecretVault(),
    toolTurn?: ToolTurnFn,
  ) {
    this.audit = new AuditService(db);
    this.authBroker = new AuthBrokerService(db, vault);
    this.integrationKeys = new IntegrationKeyStore(db, vault);
    this.operations = new OperationsService(db);
    this.rateLimitRegistry = new ProviderRateLimitRegistry(db);
    this.requestStore = new ProviderRequestStore(db);
    this.responseObserver = new ProviderResponseObserver(db, this.audit, this.operations, this.requestStore, this.rateLimitRegistry);
    this.background = new ProviderBackgroundService(db, adapters, vault);
    this.runner = new ProviderResponseRunner({
      db,
      adapters,
      audit: this.audit,
      authBroker: this.authBroker,
      integrationKeys: this.integrationKeys,
      operations: this.operations,
      rateLimitRegistry: this.rateLimitRegistry,
      responseObserver: this.responseObserver,
      requestStore: this.requestStore,
      background: this.background,
      toolTurn,
    });
  }

  createResponse(input: ProviderResponseCreateInput): Promise<string> {
    return this.runner.createResponse(input);
  }

  streamResponse(input: StreamProviderResponseInput, onEvent: (event: ProviderStreamRendererEvent) => void): Promise<string> {
    return this.runner.streamResponse(input, onEvent);
  }

  cancelResponse(input: CancelProviderResponseInput): Promise<void> {
    return this.runner.cancelResponse(input);
  }

  runToolTurn(input: Parameters<ProviderResponseRunner["runToolTurn"]>[0]): ReturnType<ProviderResponseRunner["runToolTurn"]> {
    return this.runner.runToolTurn(input);
  }

  saveCredential(input: SaveProviderCredentialInput): void {
    const provider = this.db.prepare("select * from providers where id = ? and org_id = ?")
      .get(input.providerId, input.orgId) as { provider_key: string; auth_type: ProviderAuthType } | undefined;
    if (!provider) throw new Error("Provider was not found.");
    const secret = input.secret.trim();
    if (!secret) throw new Error("Credential is required.");
    const adapter = requireAdapter(this.adapters, provider.provider_key, provider.auth_type);
    adapter.parseAuthProfile(secret);
    const catalogEntry = requireCatalogEntry(provider.provider_key);
    const source = this.resolveCredentialSource(provider.auth_type);
    const authProfile = this.authBroker.createProviderProfile({
      orgId: input.orgId,
      providerId: input.providerId,
      providerKey: provider.provider_key,
      authType: provider.auth_type,
      secret,
      profileKind: provider.auth_type,
      sourceType: source.sourceType,
      sourceRef: source.sourceRef,
      capabilityTags: catalogEntry.capabilityTags,
    });
    this.db.prepare(`
      update providers
      set credential_id = ?, model = ?, enabled = 1, auth_state = ?, health_state = ?, last_error = null, last_checked_at = null
      where id = ? and org_id = ?
    `).run(authProfile.credentialId, input.model, AUTH_STATE_CONFIGURED, HEALTH_STATE_UNCHECKED, input.providerId, input.orgId);
    this.audit.record({
      orgId: input.orgId,
      entityType: "provider",
      entityId: input.providerId,
      actorType: "system",
      actorId: null,
      action: "credential_saved",
      payload: { providerKey: provider.provider_key, authType: provider.auth_type, authProfileId: authProfile.authProfileId, sourceType: source.sourceType, sourceRef: source.sourceRef },
    });
  }

  revokeCredential(input: RevokeProviderCredentialInput): void {
    const provider = this.db.prepare(`
      select id, provider_key
      from providers
      where id = ? and org_id = ?
    `).get(input.providerId, input.orgId) as { id: string; provider_key: string } | undefined;
    if (!provider) throw new Error("Provider was not found.");
    this.authBroker.revokeProviderProfile({
      orgId: input.orgId,
      providerId: input.providerId,
      providerKey: provider.provider_key,
    });
    this.db.prepare(`
      update providers
      set credential_id = null, enabled = 0, auth_state = ?, health_state = ?, last_error = null, last_checked_at = null
      where id = ? and org_id = ?
    `).run(AUTH_STATE_REVOKED, HEALTH_STATE_UNCHECKED, input.providerId, input.orgId);
    // Sessions mid-turn on this provider stop now instead of finishing on a revoked account.
    const label = (this.db.prepare("select label from providers where id = ?").get(input.providerId) as { label: string }).label;
    const running = this.db.prepare("select id from task_runs where provider_id = ? and state = 'running'").all(input.providerId) as Array<{ id: string }>;
    for (const run of running) stopRun(run.id, `${label} was disconnected.`);
    this.audit.record({
      orgId: input.orgId,
      entityType: "provider",
      entityId: input.providerId,
      actorType: "system",
      actorId: null,
      action: "credential_revoked",
      payload: { providerKey: provider.provider_key },
    });
  }

  /**
   * Fetches the live model catalog from the provider. Onboarding passes the
   * just-typed (or just-authorized) credential as `secret`; settings passes a
   * stored provider reference and the secret is decrypted server-side. Either
   * way the credential never round-trips through the renderer's persisted state.
   */
  async listModels(input: ListProviderModelsInput): Promise<ProviderModelEntry[]> {
    if (typeof input.secret === "string") {
      const entry = requireCatalogEntry(input.providerKey);
      const adapter = requireAdapter(this.adapters, input.providerKey, entry.authType);
      const authProfile = adapter.parseAuthProfile(input.secret);
      return adapter.listModels({ authProfile, model: null });
    }
    if (!input.orgId || !input.providerId) throw new Error("A credential is required to list provider models.");
    const provider = loadConfiguredProvider(this.db, input.orgId, input.providerId);
    const adapter = requireAdapter(this.adapters, provider.provider_key, provider.auth_type);
    const credential = loadCredential(this.authBroker, input.orgId, provider);
    const authProfile = adapter.parseAuthProfile(credential.secret);
    return adapter.listModels({ authProfile, model: provider.model });
  }

  checkModel(input: { orgId: string; providerId: string; model: string }): Promise<ModelCheckResult> {
    return this.runner.checkModel(input);
  }

  /** Health is a real agent call to the default model: account, endpoint and model all have to work. */
  async checkHealth(orgId: string, providerId: string): Promise<void> {
    const provider = loadConfiguredProvider(this.db, orgId, providerId);
    try {
      if (!provider.model) throw new Error("Pick a default model; the health check is a real call to it.");
      const check = await this.runner.checkModel({ orgId, providerId, model: provider.model });
      if (!check.passed) throw new Error(`${provider.model} answered but cannot do agent work: ${check.detail}.`);
      recordProviderHealth(this.db, provider.id, orgId, HEALTH_STATE_HEALTHY, null);
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
      recordProviderHealth(this.db, provider.id, orgId, HEALTH_STATE_FAILED, message);
      throw error;
    }
  }



  /** Sets the per-million-token prices that turn recorded usage into spend. */
  setPrices(input: SetProviderPricesInput): void {
    const cents = (dollars: number | null, label: string): number | null => {
      if (dollars === null) return null;
      if (!Number.isFinite(dollars) || dollars < 0) throw new Error(`${label} price must be a number of dollars per million tokens, zero or more.`);
      return dollars * 100;
    };
    const inputCents = cents(input.inputDollarsPerMtok, "Input");
    const outputCents = cents(input.outputDollarsPerMtok, "Output");
    if ((inputCents === null) !== (outputCents === null)) throw new Error("Set both the input and the output price, or neither.");
    const result = this.db.prepare(`
      update providers set input_cents_per_mtok = ?, cached_input_cents_per_mtok = ?, output_cents_per_mtok = ?
      where id = ? and org_id = ?
    `).run(inputCents, cents(input.cachedInputDollarsPerMtok, "Cached input"), outputCents, input.providerId, input.orgId);
    if (result.changes === 0) throw new Error("Provider was not found.");
    this.audit.record({
      orgId: input.orgId, entityType: "provider", entityId: input.providerId, actorType: "employee", actorId: null,
      action: "prices_updated", payload: { input: input.inputDollarsPerMtok, cachedInput: input.cachedInputDollarsPerMtok, output: input.outputDollarsPerMtok },
    });
  }

  updatePolicy(input: UpdateProviderPolicyInput): void {
    const monthlyRequestLimit = Math.trunc(input.monthlyRequestLimit);
    if (monthlyRequestLimit < 1) throw new Error("Monthly request limit must be at least 1.");
    const contextWindowTokens = Math.trunc(input.contextWindowTokens);
    if (!(contextWindowTokens >= MIN_CONTEXT_WINDOW_TOKENS)) {
      throw new Error(`Context window must be at least ${MIN_CONTEXT_WINDOW_TOKENS} tokens.`);
    }
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
      set data_policy = ?, background_enabled = ?, monthly_request_limit = ?, workspace_scope = ?, context_window_tokens = ?
      where id = ? and org_id = ?
    `).run(input.dataPolicy, input.backgroundEnabled ? 1 : 0, monthlyRequestLimit, input.workspaceScope, contextWindowTokens, input.providerId, input.orgId);
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
        contextWindowTokens,
      },
    });
  }

  private resolveCredentialSource(authType: ProviderAuthType): { sourceType: string; sourceRef: null } {
    if (authType !== PROVIDER_AUTH_TYPE.OAUTH_PKCE && authType !== PROVIDER_AUTH_TYPE.ACCOUNT_SUBSCRIPTION) {
      return { sourceType: "manual_secret", sourceRef: null };
    }
    // A sign-in credential can only come from the native OAuth login: parseStoredOAuth refuses anything else.
    return { sourceType: "provider_oauth_login", sourceRef: null };
  }

}
