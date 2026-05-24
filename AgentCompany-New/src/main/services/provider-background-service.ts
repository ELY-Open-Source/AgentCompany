import type { DatabaseSync } from "node:sqlite";
import type { CreateProviderResponseInput } from "../../shared/commands";
import {
  FEATURE_FLAG_KEY,
  PROVIDER_AUTH_TYPE,
  PROVIDER_DATA_POLICY,
  PROVIDER_EXECUTION_MODE,
  PROVIDER_REQUEST_STATE,
  type ProviderAuthType,
  type ProviderExecutionMode,
} from "../../shared/domain";
import { currentProviderUsageWindow, type ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";
import { AuditService } from "./audit-service";
import { AuthBrokerService, type ProviderSecretVault } from "./auth-broker-service";
import { OperationsService } from "./operations-service";
import { SecretVault } from "./secret-vault";
import { providerAdapters, type ProviderAdapterRegistry } from "./provider-adapters";
import { ProviderRateLimitRegistry } from "./provider-rate-limit-registry";
import { ProviderRequestStore, type ProviderBackgroundRequestRow } from "./provider-request-store";
import { ProviderResponseObserver } from "./provider-response-observer";
import { hashPrompt, readProviderFailureMessage, requireBackgroundText } from "./provider-response-utils";

const AUTH_STATE_CONFIGURED = "configured";
const HEALTH_STATE_HEALTHY = "healthy";
const ACTIVE_BACKGROUND_STATUSES = new Set(["queued", "in_progress"]);
const FAILED_BACKGROUND_STATUSES = new Set(["failed", "incomplete"]);
const CANCELLED_BACKGROUND_STATUSES = new Set(["cancelled"]);

export class ProviderBackgroundService {
  private readonly audit: AuditService;
  private readonly authBroker: AuthBrokerService;
  private readonly operations: OperationsService;
  private readonly rateLimitRegistry: ProviderRateLimitRegistry;
  private readonly requestStore: ProviderRequestStore;
  private readonly responseObserver: ProviderResponseObserver;

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

  async create(input: CreateProviderResponseInput): Promise<string> {
    const execution = this.prepareExecution(input);
    const requestId = this.requestStore.create({
      orgId: input.orgId,
      provider: execution.provider,
      model: execution.provider.model,
      promptSha256: hashPrompt(execution.prompt),
      inputCharCount: execution.prompt.length,
      executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
      createdAt: new Date().toISOString(),
    });
    const startedAt = Date.now();
    try {
      const authProfile = execution.adapter.parseAuthProfile(execution.credential.secret);
      const result = await execution.adapter.createBackgroundResponse({
        authProfile,
        model: execution.provider.model,
        prompt: execution.prompt,
        instructions: execution.instructions,
      });
      this.recordObservedRateLimit(input.orgId, execution.provider, execution.provider.model, result.rateLimitState);
      this.requestStore.markBackgroundAccepted({
        orgId: input.orgId,
        requestId,
        rawResponseJson: result.rawResponseJson,
        externalResponseId: result.responseId,
      });
      this.recordProviderHealth(execution.provider.id, input.orgId, HEALTH_STATE_HEALTHY, null);
      this.audit.record({
        orgId: input.orgId,
        entityType: "provider_request",
        entityId: requestId,
        actorType: "system",
        actorId: null,
        action: "background_response_started",
        payload: { providerKey: execution.provider.provider_key, model: execution.provider.model, status: result.status },
      });
      return requestId;
    } catch (error) {
      this.responseObserver.recordFailure({
        orgId: input.orgId,
        provider: execution.provider,
        requestId,
        executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
        startedAt,
        inputCharCount: execution.prompt.length,
        error,
      });
      throw error;
    }
  }

  async poll(input: { orgId: string; requestId: string }): Promise<void> {
    await this.pollRow(this.requestStore.loadBackgroundRequest(input.orgId, input.requestId));
  }

  async recoverBackgroundResponses(orgId?: string): Promise<number> {
    const requests = this.requestStore.listRecoverableBackgroundRequests(orgId);
    let recovered = 0;
    for (const request of requests) {
      await this.pollRow(request);
      recovered += 1;
    }
    return recovered;
  }

  private async pollRow(request: ProviderBackgroundRequestRow): Promise<void> {
    let provider: ProviderRow | ProviderBackgroundRequestProvider = {
      id: request.provider_id,
      provider_key: request.provider_key,
      model: request.model,
    };
    const startedAt = Date.now();
    try {
      const providerRow = this.loadConfiguredProvider(request.org_id, request.provider_id);
      provider = providerRow;
      const adapter = this.requireAdapter(providerRow.provider_key, providerRow.auth_type);
      const credential = this.loadCredential(request.org_id, providerRow);
      const result = await adapter.retrieveResponse({
        authProfile: adapter.parseAuthProfile(credential.secret),
        responseId: request.external_response_id,
      });
      this.recordObservedRateLimit(request.org_id, providerRow, providerRow.model, result.rateLimitState);
      if (ACTIVE_BACKGROUND_STATUSES.has(result.status)) {
        this.requestStore.markBackgroundProgress({
          orgId: request.org_id,
          requestId: request.id,
          rawResponseJson: result.rawResponseJson,
          externalResponseId: result.responseId,
          state: result.status === "in_progress" ? PROVIDER_REQUEST_STATE.STREAMING : PROVIDER_REQUEST_STATE.PENDING,
        });
        this.recordProviderHealth(provider.id, request.org_id, HEALTH_STATE_HEALTHY, null);
        return;
      }
      if (result.status === "completed") {
        const responseText = requireBackgroundText(result.text, provider.provider_key);
        this.requestStore.markSucceeded({
          orgId: request.org_id,
          requestId: request.id,
          responseText,
          rawResponseJson: result.rawResponseJson,
          outputCharCount: responseText.length,
          externalResponseId: result.responseId,
          completedAt: new Date().toISOString(),
        });
        this.responseObserver.recordSuccess({
          orgId: request.org_id,
          provider,
          requestId: request.id,
          executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
          startedAt,
          action: "background_response_completed",
        });
        this.requestStore.recordUsage(request.org_id, provider.id, request.input_char_count, responseText.length);
        return;
      }
      if (CANCELLED_BACKGROUND_STATUSES.has(result.status)) {
        this.requestStore.markCancelled({
          orgId: request.org_id,
          requestId: request.id,
          rawResponseJson: result.rawResponseJson,
          externalResponseId: result.responseId,
          cancelledAt: new Date().toISOString(),
        });
        this.recordProviderHealth(provider.id, request.org_id, HEALTH_STATE_HEALTHY, null);
        return;
      }
      if (FAILED_BACKGROUND_STATUSES.has(result.status)) {
        throw new ProviderBackgroundStatusError(readProviderFailureMessage(result.rawResponseJson, result.status), result.rawResponseJson);
      }
      throw new Error(`Provider background response returned unsupported status ${result.status}.`);
    } catch (error) {
      this.responseObserver.recordFailure({
        orgId: request.org_id,
        provider,
        requestId: request.id,
        executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
        startedAt,
        inputCharCount: request.input_char_count,
        error,
        rawResponseJson: error instanceof ProviderBackgroundStatusError ? error.rawResponseJson : null,
      });
    }
  }

  private prepareExecution(input: CreateProviderResponseInput): PreparedBackgroundExecution {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("Prompt is required.");
    const provider = this.loadConfiguredProvider(input.orgId, input.providerId);
    this.enforcePolicy(input.orgId, provider, input.executionMode ?? PROVIDER_EXECUTION_MODE.BACKGROUND);
    if (provider.auth_type !== PROVIDER_AUTH_TYPE.API_KEY) {
      throw new Error("Provider background execution requires an API key adapter.");
    }
    if (!provider.model) throw new Error("Provider model is required.");
    return {
      prompt,
      instructions: input.instructions?.trim() || null,
      provider: { ...provider, model: provider.model },
      adapter: this.requireAdapter(provider.provider_key, provider.auth_type),
      credential: this.loadCredential(input.orgId, provider),
    };
  }

  private enforcePolicy(orgId: string, provider: ProviderRow, executionMode: ProviderExecutionMode): void {
    if (executionMode !== PROVIDER_EXECUTION_MODE.BACKGROUND) throw new Error("Provider background execution mode is required.");
    if (provider.data_policy === PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION) {
      throw new Error("Background execution conflicts with zero data retention policy.");
    }
    if (!this.operations.isFeatureEnabled(orgId, FEATURE_FLAG_KEY.PROVIDER_BACKGROUND_EXECUTION)) {
      throw new Error("Provider background execution is disabled by feature flag.");
    }
    if (provider.background_enabled !== 1) throw new Error("Background execution is disabled for this provider policy.");
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

interface PreparedBackgroundExecution {
  prompt: string;
  instructions: string | null;
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

interface ProviderBackgroundRequestProvider {
  id: string;
  provider_key: string;
  model: string;
}

class ProviderBackgroundStatusError extends Error {
  constructor(message: string, readonly rawResponseJson: string) {
    super(message);
    this.name = "ProviderBackgroundStatusError";
  }
}
