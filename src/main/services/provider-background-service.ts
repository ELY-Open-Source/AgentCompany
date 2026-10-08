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
import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";
import { AuditService } from "./audit-service";
import { AuthBrokerService, type ProviderSecretVault } from "./auth-broker-service";
import { OperationsService } from "./operations-service";
import { SecretVault } from "./secret-vault";
import { providerAdapters, type ProviderAdapterRegistry } from "./provider-adapters";
import { ProviderRateLimitRegistry } from "./provider-rate-limit-registry";
import { ProviderRequestStore, type ProviderBackgroundRequestRow } from "./provider-request-store";
import { ProviderResponseObserver } from "./provider-response-observer";
import { hashPrompt, readProviderFailureMessage, requireBackgroundText } from "./provider-response-utils";
import { promptChars } from "./spend";
import { isRecord, ProviderHttpError, readProviderErrorCode } from "./provider-http";

const AUTH_STATE_CONFIGURED = "configured";
const HEALTH_STATE_HEALTHY = "healthy";
const ACTIVE_BACKGROUND_STATUSES = new Set(["queued", "in_progress"]);
const FAILED_BACKGROUND_STATUSES = new Set(["failed", "incomplete"]);
const MAX_POLL_FAILURES = 10;
const CANCELLED_BACKGROUND_STATUSES = new Set(["cancelled"]);

type BackgroundCreateInput = CreateProviderResponseInput & {
  onRequestCreated?: (requestId: string) => void;
};

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

  async create(input: BackgroundCreateInput): Promise<string> {
    const execution = this.prepareExecution(input);
    const requestId = this.requestStore.create({
      orgId: input.orgId,
      provider: execution.provider,
      model: execution.provider.model,
      workspaceId: execution.workspaceId,
      promptSha256: hashPrompt(execution.prompt),
      inputCharCount: promptChars(execution.prompt, execution.instructions),
      executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
      createdAt: new Date().toISOString(),
    });
    input.onRequestCreated?.(requestId);
    const startedAt = Date.now();
    try {
      // Read inside the request's try, so an unreadable credential is logged as this request's failure.
      const authProfile = execution.adapter.parseAuthProfile(this.loadCredential(input.orgId, execution.provider).secret);
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
        inputCharCount: promptChars(execution.prompt, execution.instructions),
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
        this.requestStore.clearPollFailures(request.id);
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
        this.requestStore.clearPollFailures(request.id);
        const finished = this.requestStore.markSucceeded({
          orgId: request.org_id,
          requestId: request.id,
          responseText,
          rawResponseJson: result.rawResponseJson,
          outputCharCount: responseText.length,
          externalResponseId: result.responseId,
          completedAt: new Date().toISOString(),
        });
        if (!finished) return;
        this.responseObserver.recordSuccess({
          orgId: request.org_id,
          provider,
          requestId: request.id,
          executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
          startedAt,
          action: "background_response_completed",
        });
        this.requestStore.settleUsage({
          orgId: request.org_id, requestId: request.id, provider, rawResponseJson: result.rawResponseJson,
          inputCharCount: request.input_char_count, outputCharCount: responseText.length,
        });
        return;
      }
      if (CANCELLED_BACKGROUND_STATUSES.has(result.status)) {
        this.requestStore.clearPollFailures(request.id);
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
        throw new ProviderBackgroundStatusError(readProviderFailureMessage(result.rawResponseJson, result.status), result.rawResponseJson, readBackgroundFailureCode(result.rawResponseJson));
      }
      throw new Error(`Provider background response returned unsupported status ${result.status}.`);
    } catch (error) {
      // The provider reporting failure is final; a failed status check is not, since the remote job may still finish.
      let finalError = error;
      if (!(error instanceof ProviderBackgroundStatusError)) {
        const message = error instanceof Error ? error.message : String(error);
        const failures = this.requestStore.recordPollFailure(request.id, message);
        console.warn(`[provider-background] status check ${failures}/${MAX_POLL_FAILURES} for request ${request.id} failed: ${message}`);
        if (failures < MAX_POLL_FAILURES) return;
        const gaveUp = `Gave up after ${MAX_POLL_FAILURES} failed status checks: ${message}`;
        finalError = error instanceof ProviderHttpError ? new ProviderHttpError(gaveUp, error.rateLimitState, error.status, error.timedOut, error.code) : new Error(gaveUp);
      }
      this.responseObserver.recordFailure({
        orgId: request.org_id,
        provider,
        requestId: request.id,
        executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
        startedAt,
        inputCharCount: request.input_char_count,
        error: finalError,
        rawResponseJson: error instanceof ProviderBackgroundStatusError ? error.rawResponseJson : null,
      });
    }
  }

  private prepareExecution(input: CreateProviderResponseInput): PreparedBackgroundExecution {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("Prompt is required.");
    const provider = this.loadConfiguredProvider(input.orgId, input.providerId);
    const workspaceId = this.normalizeWorkspaceId(input.orgId, input.workspaceId ?? null);
    this.enforcePolicy(input.orgId, provider, input.executionMode ?? PROVIDER_EXECUTION_MODE.BACKGROUND, workspaceId);
    if (provider.auth_type !== PROVIDER_AUTH_TYPE.API_KEY) {
      throw new Error("Provider background execution requires an API key adapter.");
    }
    if (!provider.model) throw new Error("Provider model is required.");
    return {
      workspaceId,
      prompt,
      instructions: input.instructions?.trim() || null,
      provider: { ...provider, model: provider.model },
      adapter: this.requireAdapter(provider.provider_key, provider.auth_type),
    };
  }

  private enforcePolicy(orgId: string, provider: ProviderRow, executionMode: ProviderExecutionMode, workspaceId: string | null): void {
    if (executionMode !== PROVIDER_EXECUTION_MODE.BACKGROUND) throw new Error("Provider background execution mode is required.");
    if (provider.workspace_scope !== "organization" && provider.workspace_scope !== "workspace") throw new Error("Provider workspace scope is invalid.");
    if (provider.workspace_scope === "workspace" && !workspaceId) {
      throw new Error("Provider workspace scope requires a workspace context.");
    }
    if (provider.data_policy === PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION) {
      throw new Error("Background execution conflicts with zero data retention policy.");
    }
    if (!this.operations.isFeatureEnabled(orgId, FEATURE_FLAG_KEY.PROVIDER_BACKGROUND_EXECUTION)) {
      throw new Error("Provider background execution is disabled by feature flag.");
    }
    if (provider.background_enabled !== 1) throw new Error("Background execution is disabled for this provider policy.");
    this.requestStore.assertMonthlyCapacity(orgId, provider);
  }

  private normalizeWorkspaceId(orgId: string, workspaceId: string | null): string | null {
    const normalized = workspaceId?.trim() || null;
    if (!normalized) return null;
    const workspace = this.db.prepare("select id from workspaces where id = ? and org_id = ?")
      .get(normalized, orgId) as { id: string } | undefined;
    if (!workspace) throw new Error("Provider workspace context was not found.");
    return normalized;
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
  workspaceId: string | null;
  prompt: string;
  instructions: string | null;
  provider: ProviderRow & { model: string };
  adapter: ProviderAdapterRegistry[string];
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

/** The provider reported the background job failed or incomplete; its code is the error's code or the incomplete reason. */
class ProviderBackgroundStatusError extends ProviderHttpError {
  constructor(message: string, readonly rawResponseJson: string, code: string | null) {
    super(message, null, null, false, code);
    this.name = "ProviderBackgroundStatusError";
  }
}

function readBackgroundFailureCode(rawResponseJson: string): string | null {
  const parsed = JSON.parse(rawResponseJson) as unknown;
  if (!isRecord(parsed)) return null;
  const incomplete = parsed.incomplete_details;
  return readProviderErrorCode(parsed) ?? (isRecord(incomplete) && typeof incomplete.reason === "string" ? incomplete.reason : null);
}
