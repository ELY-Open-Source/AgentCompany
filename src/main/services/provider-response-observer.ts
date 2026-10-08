import type { DatabaseSync } from "node:sqlite";
import { SLO_SIGNAL_KEY, type ProviderExecutionMode } from "../../shared/domain";
import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";
import { AuditService } from "./audit-service";
import { OperationsService } from "./operations-service";
import { providerRateLimitStateFromError } from "./provider-adapters";
import { ProviderRateLimitRegistry } from "./provider-rate-limit-registry";
import { ProviderRequestStore } from "./provider-request-store";

const HEALTH_STATE_HEALTHY = "healthy";
const HEALTH_STATE_FAILED = "failed";

export interface ProviderResponseObserverProvider {
  id: string;
  provider_key: string;
  model: string | null;
}

export interface ProviderResponseSuccessInput {
  orgId: string;
  provider: ProviderResponseObserverProvider;
  requestId: string;
  executionMode: ProviderExecutionMode;
  startedAt: number;
  action: "response_created" | "response_streamed" | "background_response_completed";
}

export interface ProviderResponseFailureInput {
  orgId: string;
  provider: ProviderResponseObserverProvider;
  requestId: string;
  executionMode: ProviderExecutionMode;
  startedAt: number;
  inputCharCount: number;
  error: unknown;
  rawResponseJson?: string | null;
}

export class ProviderResponseObserver {
  constructor(
    private readonly db: DatabaseSync,
    private readonly audit: AuditService,
    private readonly operations: OperationsService,
    private readonly requestStore: ProviderRequestStore,
    private readonly rateLimitRegistry: ProviderRateLimitRegistry,
  ) {}

  recordSuccess(input: ProviderResponseSuccessInput): void {
    this.recordProviderHealth(input.provider.id, input.orgId, HEALTH_STATE_HEALTHY, null);
    this.audit.record({
      orgId: input.orgId,
      entityType: "provider_request",
      entityId: input.requestId,
      actorType: "system",
      actorId: null,
      action: input.action,
      payload: { providerKey: input.provider.provider_key, model: input.provider.model },
    });
    this.operations.recordSignal({
      orgId: input.orgId,
      signalKey: SLO_SIGNAL_KEY.PROVIDER_REQUEST_SUCCESS,
      source: "provider_gateway",
      success: true,
      durationMs: Date.now() - input.startedAt,
      detail: { requestId: input.requestId, providerKey: input.provider.provider_key, executionMode: input.executionMode },
    });
  }

  recordFailure(input: ProviderResponseFailureInput): void {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    this.recordObservedRateLimit(input.orgId, input.provider, input.provider.model, providerRateLimitStateFromError(input.error));
    const failed = this.requestStore.markFailed({
      orgId: input.orgId,
      requestId: input.requestId,
      errorMessage: message,
      completedAt: new Date().toISOString(),
      rawResponseJson: input.rawResponseJson,
    });
    // A late error on a request already cancelled or finished changes nothing.
    if (!failed) return;
    this.requestStore.recordUsage(input.orgId, input.provider.id, input.inputCharCount, 0, null);
    this.recordProviderHealth(input.provider.id, input.orgId, HEALTH_STATE_FAILED, message);
    this.operations.recordSignal({
      orgId: input.orgId,
      signalKey: SLO_SIGNAL_KEY.PROVIDER_REQUEST_SUCCESS,
      source: "provider_gateway",
      success: false,
      durationMs: Date.now() - input.startedAt,
      detail: { requestId: input.requestId, providerKey: input.provider.provider_key, executionMode: input.executionMode },
    });
  }

  recordObservedRateLimit(
    orgId: string,
    provider: ProviderResponseObserverProvider,
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

  private recordProviderHealth(providerId: string, orgId: string, healthState: string, error: string | null): void {
    this.db.prepare(`
      update providers
      set health_state = ?, last_error = ?, last_checked_at = ?
      where id = ? and org_id = ?
    `).run(healthState, error, new Date().toISOString(), providerId, orgId);
  }
}
