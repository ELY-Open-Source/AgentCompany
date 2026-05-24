import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { CancelProviderResponseInput, CreateProviderResponseInput, RevokeProviderCredentialInput, SaveProviderCredentialInput, StreamProviderResponseInput, UpdateProviderPolicyInput } from "../../shared/commands";
import { FEATURE_FLAG_KEY, PROVIDER_AUTH_TYPE, PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE, PROVIDER_REQUEST_STATE, type ProviderAuthType, type ProviderExecutionMode } from "../../shared/domain";
import type { ProviderStreamRendererEvent } from "../../shared/provider-request-domain";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog";
import { currentProviderUsageWindow } from "../../shared/provider-runtime-domain";
import { AuditService } from "./audit-service";
import { AuthBrokerService, type ProviderSecretVault } from "./auth-broker-service";
import { OperationsService } from "./operations-service";
import { SecretVault } from "./secret-vault";
import { providerAdapters, providerRateLimitStateFromError, type ProviderAdapterRegistry } from "./provider-adapters";
import { ProviderRateLimitRegistry } from "./provider-rate-limit-registry";
import { ProviderResponseObserver } from "./provider-response-observer";
import { readProviderResponseId, requireStreamText } from "./provider-response-utils";
import { ProviderRequestStore } from "./provider-request-store";
import { launchProviderSignInWindow } from "./provider-sign-in-window";
import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";

const AUTH_STATE_CONFIGURED = "configured";
const AUTH_STATE_REVOKED = "revoked";
const HEALTH_STATE_HEALTHY = "healthy";
const HEALTH_STATE_FAILED = "failed";
const HEALTH_STATE_UNCHECKED = "unchecked";
const WORKSPACE_SCOPES = new Set(["organization", "workspace"]);

export class ProviderService {
  private readonly audit: AuditService;
  private readonly authBroker: AuthBrokerService;
  private readonly operations: OperationsService;
  private readonly rateLimitRegistry: ProviderRateLimitRegistry;
  private readonly responseObserver: ProviderResponseObserver;
  private readonly requestStore: ProviderRequestStore;

  constructor(
    private readonly db: DatabaseSync,
    private readonly adapters: ProviderAdapterRegistry = providerAdapters,
    vault: ProviderSecretVault = new SecretVault(),
  ) {
    this.audit = new AuditService(db);
    this.authBroker = new AuthBrokerService(db, vault);
    this.operations = new OperationsService(db);
    this.rateLimitRegistry = new ProviderRateLimitRegistry(db);
    this.requestStore = new ProviderRequestStore(db);
    this.responseObserver = new ProviderResponseObserver(db, this.audit, this.operations, this.requestStore, this.rateLimitRegistry);
  }

  saveCredential(input: SaveProviderCredentialInput): void {
    const provider = this.db.prepare("select * from providers where id = ? and org_id = ?")
      .get(input.providerId, input.orgId) as { provider_key: string; auth_type: ProviderAuthType } | undefined;
    if (!provider) throw new Error("Provider was not found.");
    const secret = input.secret.trim();
    if (!secret) throw new Error("Credential is required.");
    const adapter = this.requireAdapter(provider.provider_key, provider.auth_type);
    adapter.parseAuthProfile(secret);
    const catalogEntry = this.requireCatalogEntry(provider.provider_key);
    const authProfile = this.authBroker.createProviderProfile({
      orgId: input.orgId,
      providerId: input.providerId,
      providerKey: provider.provider_key,
      authType: provider.auth_type,
      secret,
      profileKind: provider.auth_type,
      sourceType: "manual_secret",
      sourceRef: null,
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
      payload: { providerKey: provider.provider_key, authType: provider.auth_type, authProfileId: authProfile.authProfileId },
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

  async checkHealth(orgId: string, providerId: string): Promise<void> {
    const provider = this.loadConfiguredProvider(orgId, providerId);
    const adapter = this.requireAdapter(provider.provider_key, provider.auth_type);
    const credential = this.loadCredential(orgId, provider);
    try {
      const profile = adapter.parseAuthProfile(credential.secret);
      const result = await adapter.checkHealth({ authProfile: profile, model: provider.model });
      this.recordObservedRateLimit(orgId, provider, provider.model, result.rateLimitState);
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
      this.recordObservedRateLimit(orgId, provider, provider.model, providerRateLimitStateFromError(error));
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
    const catalogEntry = this.requireCatalogEntry(provider.provider_key);
    if (!catalogEntry.signInUrl) throw new Error(`${provider.label} does not support browser sign-in.`);
    launchProviderSignInWindow({ providerId: provider.id, label: provider.label, signInUrl: catalogEntry.signInUrl });

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

  async createResponse(input: CreateProviderResponseInput): Promise<string> {
    const execution = this.prepareExecution(input);
    if (!execution.adapter.createResponse) throw new Error(`Provider response execution is unavailable for ${execution.provider.provider_key}.`);
    const requestId = this.createRequestRecord(execution);
    const startedAt = Date.now();
    try {
      const authProfile = execution.adapter.parseAuthProfile(execution.credential.secret);
      const result = await execution.adapter.createResponse({
        authProfile,
        model: execution.provider.model,
        prompt: execution.prompt,
        instructions: execution.instructions,
      });
      this.recordObservedRateLimit(input.orgId, execution.provider, execution.provider.model, result.rateLimitState);
      this.requestStore.markSucceeded({
        orgId: input.orgId,
        requestId,
        responseText: result.text,
        rawResponseJson: result.rawResponseJson,
        outputCharCount: result.text.length,
        externalResponseId: readProviderResponseId(result.rawResponseJson),
        completedAt: new Date().toISOString(),
      });
      this.responseObserver.recordSuccess({
        orgId: input.orgId,
        provider: execution.provider,
        requestId,
        executionMode: execution.executionMode,
        startedAt,
        action: "response_created",
      });
      this.requestStore.recordUsage(input.orgId, execution.provider.id, execution.prompt.length, result.text.length);
      return requestId;
    } catch (error) {
      this.responseObserver.recordFailure({
        orgId: input.orgId,
        provider: execution.provider,
        requestId,
        executionMode: execution.executionMode,
        startedAt,
        inputCharCount: execution.prompt.length,
        error,
      });
      throw error;
    }
  }

  async streamResponse(input: StreamProviderResponseInput, onEvent: (event: ProviderStreamRendererEvent) => void): Promise<string> {
    const execution = this.prepareExecution(input);
    const requestId = this.createRequestRecord(execution);
    const startedAt = Date.now();
    const rawEvents: string[] = [];
    const textParts: string[] = [];
    let providerResponseId: string | null = null;
    try {
      const authProfile = execution.adapter.parseAuthProfile(execution.credential.secret);
      const result = await execution.adapter.streamResponse({
        authProfile,
        model: execution.provider.model,
        prompt: execution.prompt,
        instructions: execution.instructions,
      });
      this.recordObservedRateLimit(input.orgId, execution.provider, execution.provider.model, result.rateLimitState);
      for await (const event of result.events) {
        if (event.type === "error") throw new Error(event.textDelta ?? "Provider stream failed.");
        rawEvents.push(event.rawEventJson);
        if (event.providerResponseId) providerResponseId = event.providerResponseId;
        if (event.textDelta) textParts.push(event.textDelta);
        const responseText = textParts.join("");
        const streamEventCount = rawEvents.length;
        this.requestStore.markStreaming({
          orgId: input.orgId,
          requestId,
          responseText,
          rawResponseJson: JSON.stringify(rawEvents),
          outputCharCount: responseText.length,
          streamEventCount,
          externalResponseId: providerResponseId,
        });
        onEvent({
          requestId,
          providerId: execution.provider.id,
          providerKey: execution.provider.provider_key,
          model: execution.provider.model,
          streamEventType: event.type,
          textDelta: event.textDelta,
          responseText,
          providerResponseId,
          rawEventJson: event.rawEventJson,
          streamEventCount,
        });
      }
      const responseText = requireStreamText(textParts);
      this.requestStore.markSucceeded({
        orgId: input.orgId,
        requestId,
        responseText,
        rawResponseJson: JSON.stringify(rawEvents),
        outputCharCount: responseText.length,
        externalResponseId: providerResponseId,
        completedAt: new Date().toISOString(),
      });
      this.responseObserver.recordSuccess({
        orgId: input.orgId,
        provider: execution.provider,
        requestId,
        executionMode: execution.executionMode,
        startedAt,
        action: "response_streamed",
      });
      this.requestStore.recordUsage(input.orgId, execution.provider.id, execution.prompt.length, responseText.length);
      return requestId;
    } catch (error) {
      this.responseObserver.recordFailure({
        orgId: input.orgId,
        provider: execution.provider,
        requestId,
        executionMode: execution.executionMode,
        startedAt,
        inputCharCount: execution.prompt.length,
        error,
      });
      throw error;
    }
  }

  async cancelResponse(input: CancelProviderResponseInput): Promise<void> {
    const request = this.requestStore.loadCancellationRow(input.orgId, input.requestId);
    if (request.state !== PROVIDER_REQUEST_STATE.PENDING && request.state !== PROVIDER_REQUEST_STATE.STREAMING) {
      throw new Error(`Provider request cannot be cancelled from state ${request.state}.`);
    }
    const providerResponseId = input.providerResponseId?.trim() || request.external_response_id;
    if (!providerResponseId) throw new Error("Provider response id is required.");
    const provider = this.loadConfiguredProvider(input.orgId, request.provider_id);
    const adapter = this.requireAdapter(provider.provider_key, provider.auth_type);
    const credential = this.loadCredential(input.orgId, provider);
    const authProfile = adapter.parseAuthProfile(credential.secret);
    const result = await adapter.cancelResponse({ authProfile, responseId: providerResponseId });
    this.recordObservedRateLimit(input.orgId, provider, provider.model, result.rateLimitState);
    this.requestStore.markCancelled({
      orgId: input.orgId,
      requestId: input.requestId,
      rawResponseJson: result.rawResponseJson,
      externalResponseId: providerResponseId,
      cancelledAt: new Date().toISOString(),
    });
    this.recordProviderHealth(provider.id, input.orgId, HEALTH_STATE_HEALTHY, null);
    this.audit.record({
      orgId: input.orgId,
      entityType: "provider_request",
      entityId: input.requestId,
      actorType: "system",
      actorId: null,
      action: "response_cancelled",
      payload: { providerKey: provider.provider_key, model: provider.model },
    });
  }

  private prepareExecution(input: CreateProviderResponseInput | StreamProviderResponseInput): PreparedProviderExecution {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("Prompt is required.");
    const provider = this.loadConfiguredProvider(input.orgId, input.providerId);
    const executionMode = input.executionMode ?? PROVIDER_EXECUTION_MODE.FOREGROUND;
    this.enforcePolicy(input.orgId, provider, executionMode);
    if (provider.auth_type !== PROVIDER_AUTH_TYPE.API_KEY) {
      throw new Error("Provider response execution requires an API key adapter.");
    }
    if (!provider.model) throw new Error("Provider model is required.");
    return {
      orgId: input.orgId,
      prompt,
      instructions: input.instructions?.trim() || null,
      executionMode,
      provider: { ...provider, model: provider.model },
      adapter: this.requireAdapter(provider.provider_key, provider.auth_type),
      credential: this.loadCredential(input.orgId, provider),
    };
  }

  private createRequestRecord(execution: PreparedProviderExecution): string {
    return this.requestStore.create({
      orgId: execution.orgId,
      provider: execution.provider,
      model: execution.provider.model,
      promptSha256: hashPrompt(execution.prompt),
      inputCharCount: execution.prompt.length,
      executionMode: execution.executionMode,
      createdAt: new Date().toISOString(),
    });
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
    const window = currentProviderUsageWindow();
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

  private loadCredential(orgId: string, provider: ProviderRow): { secret: string } {
    if (!provider.credential_id) throw new Error("Provider credential is required.");
    return {
      secret: this.authBroker.loadProviderSecret({
        orgId,
        providerId: provider.id,
        providerKey: provider.provider_key,
        credentialId: provider.credential_id,
      }),
    };
  }

  private requireAdapter(providerKey: string, authType: string): ProviderAdapterRegistry[string] {
    const adapter = this.adapters[providerKey];
    if (!adapter) throw new Error(`Provider adapter is unavailable for ${providerKey}.`);
    if (adapter.authType !== authType) throw new Error(`Provider adapter auth type mismatch for ${providerKey}.`);
    return adapter;
  }

  private requireCatalogEntry(providerKey: string): (typeof PROVIDER_CATALOG)[number] {
    const entry = PROVIDER_CATALOG.find((item) => item.key === providerKey);
    if (!entry) throw new Error(`Provider catalog entry missing for ${providerKey}.`);
    return entry;
  }

  private recordProviderHealth(providerId: string, orgId: string, healthState: string, error: string | null): void {
    this.db.prepare(`
      update providers
      set health_state = ?, last_error = ?, last_checked_at = ?
      where id = ? and org_id = ?
    `).run(healthState, error, new Date().toISOString(), providerId, orgId);
  }

  private recordObservedRateLimit(
    orgId: string,
    provider: Pick<ProviderRow, "id" | "provider_key">,
    model: string | null,
    state: ProviderObservedRateLimitState | null,
  ): void {
    if (!state) return;
    this.rateLimitRegistry.recordObservation({
      orgId,
      providerId: provider.id,
      providerKey: provider.provider_key,
      model,
      state,
    });
  }
}

interface PreparedProviderExecution {
  orgId: string;
  prompt: string;
  instructions: string | null;
  executionMode: ProviderExecutionMode;
  provider: ProviderRow & { model: string };
  adapter: ProviderAdapterRegistry[string];
  credential: { secret: string };
}

interface ProviderRow {
  id: string;
  provider_key: string;
  auth_type: ProviderAuthType;
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
