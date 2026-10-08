import type { IntegrationKeyStore } from "./integration-key-store";
import type { DatabaseSync } from "node:sqlite";
import type { CancelProviderResponseInput, CreateProviderResponseInput, StreamProviderResponseInput } from "../../shared/commands";
import { FEATURE_FLAG_KEY, PROVIDER_AUTH_TYPE, PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE, PROVIDER_REQUEST_STATE, type ProviderExecutionMode } from "../../shared/domain";
import type { ProviderStreamRendererEvent } from "../../shared/provider-request-domain";
import { currentProviderUsageWindow, PROVIDER_MONTHLY_LIMIT_MESSAGE } from "../../shared/provider-runtime-domain";
import type { AuditService } from "./audit-service";
import type { AuthBrokerService } from "./auth-broker-service";
import type { OperationsService } from "./operations-service";
import type { ProviderAdapterRegistry } from "./provider-adapters";
import type { ProviderBackgroundService } from "./provider-background-service";
import type { ProviderRateLimitRegistry } from "./provider-rate-limit-registry";
import type { ProviderRequestStore } from "./provider-request-store";
import type { ProviderResponseObserver } from "./provider-response-observer";
import { hashPrompt, readProviderResponseId, requireStreamText } from "./provider-response-utils";
import { type AgentTurnMessage, type AgentTurnResult, type ToolDefinition, type ToolTurnFn } from "./provider-tool-turn";
import { selectToolTurn, supportsToolTurn } from "./provider-tool-turns/router";
import { resolveTurnCredential } from "./provider-tool-turns/credential-resolver";
import { currentRunId } from "./run-control";
import { budgetBlock, isPriced, providerPrices } from "./spend";
import {
  HEALTH_STATE_HEALTHY,
  WORKSPACE_SCOPES,
  loadConfiguredProvider,
  loadCredential,
  recordObservedRateLimit,
  recordProviderHealth,
  requireAdapter,
  type ProviderRow,
} from "./provider-internal";

export type ProviderResponseCreateInput = CreateProviderResponseInput & {
  onRequestCreated?: (requestId: string) => void;
};

export interface ProviderResponseRunnerDeps {
  db: DatabaseSync;
  adapters: ProviderAdapterRegistry;
  audit: AuditService;
  authBroker: AuthBrokerService;
  integrationKeys: IntegrationKeyStore;
  operations: OperationsService;
  rateLimitRegistry: ProviderRateLimitRegistry;
  responseObserver: ProviderResponseObserver;
  requestStore: ProviderRequestStore;
  background: ProviderBackgroundService;
  /** Test-injectable override for the provider's tool-use HTTP turn. */
  toolTurn?: ToolTurnFn;
}

export class ProviderResponseRunner {
  constructor(private readonly deps: ProviderResponseRunnerDeps) {}

  async createResponse(input: ProviderResponseCreateInput): Promise<string> {
    if (input.executionMode === PROVIDER_EXECUTION_MODE.BACKGROUND) return this.deps.background.create(input);
    const execution = this.prepareExecution(input);
    if (!execution.adapter.createResponse) throw new Error(`Provider response execution is unavailable for ${execution.provider.provider_key}.`);
    const requestId = this.createRequestRecord(execution);
    input.onRequestCreated?.(requestId);
    const startedAt = Date.now();
    try {
      const authProfile = execution.adapter.parseAuthProfile(execution.credential.secret);
      const result = await execution.adapter.createResponse({
        authProfile,
        model: execution.provider.model,
        prompt: execution.prompt,
        instructions: execution.instructions,
      });
      recordObservedRateLimit(this.deps.rateLimitRegistry, input.orgId, execution.provider, execution.provider.model, result.rateLimitState);
      this.deps.requestStore.markSucceeded({
        orgId: input.orgId,
        requestId,
        responseText: result.text,
        rawResponseJson: result.rawResponseJson,
        outputCharCount: result.text.length,
        externalResponseId: readProviderResponseId(result.rawResponseJson),
        completedAt: new Date().toISOString(),
      });
      this.deps.responseObserver.recordSuccess({
        orgId: input.orgId,
        provider: execution.provider,
        requestId,
        executionMode: execution.executionMode,
        startedAt,
        action: "response_created",
      });
      this.deps.requestStore.settleUsage({
        orgId: input.orgId, requestId, provider: execution.provider, rawResponseJson: result.rawResponseJson,
        inputCharCount: execution.prompt.length, outputCharCount: result.text.length,
      });
      return requestId;
    } catch (error) {
      this.deps.responseObserver.recordFailure({
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

  async runToolTurn(input: {
    orgId: string;
    providerId: string;
    workspaceId: string | null;
    instructions: string | null;
    messages: AgentTurnMessage[];
    tools: ToolDefinition[];
  }): Promise<AgentTurnResult & { requestId: string }> {
    const provider = loadConfiguredProvider(this.deps.db, input.orgId, input.providerId);
    const workspaceId = this.normalizeWorkspaceId(input.orgId, input.workspaceId ?? null);
    this.enforcePolicy(input.orgId, provider, PROVIDER_EXECUTION_MODE.FOREGROUND, workspaceId);
    if (!supportsToolTurn(provider.provider_key)) {
      throw new Error("Agent execution is not available for this provider; assign the agent an OpenAI, Anthropic, xAI, Groq, Mistral, Cerebras, OpenRouter, GPT account, GitHub Copilot, Google Antigravity, or Claude Pro provider.");
    }
    const model = provider.model;
    if (!model) throw new Error("Provider model is required.");
    const owner: ProviderRow & { model: string } = { ...provider, model };
    const turn = this.deps.toolTurn ?? selectToolTurn(provider.provider_key);
    // A call made for a run is spent by its agent: refuse before calling once its budget is gone.
    const taskRunId = currentRunId();
    const agent = taskRunId
      ? this.deps.db.prepare("select a.id, a.department from task_runs r join agents a on a.id = r.agent_id where r.id = ?").get(taskRunId) as { id: string; department: string }
      : null;
    const blocked = agent ? budgetBlock(this.deps.db, agent.id, isPriced(providerPrices(this.deps.db, provider.id)), new Date()) : null;
    if (blocked) throw new Error(blocked);
    const credential = await resolveTurnCredential({ authBroker: this.deps.authBroker, integrationKeys: this.deps.integrationKeys, orgId: input.orgId, provider });
    const promptChars = JSON.stringify(input.messages).length;
    const requestId = this.deps.requestStore.create({
      agentId: agent?.id ?? null,
      taskRunId,
      department: agent?.department ?? null,
      orgId: input.orgId,
      provider: owner,
      model,
      workspaceId,
      promptSha256: hashPrompt(JSON.stringify(input.messages)),
      inputCharCount: promptChars,
      executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND,
      createdAt: new Date().toISOString(),
    });
    const startedAt = Date.now();
    try {
      const result = await turn({ credential, model, instructions: input.instructions, messages: input.messages, tools: input.tools });
      this.deps.requestStore.markSucceeded({
        orgId: input.orgId,
        requestId,
        responseText: result.text,
        rawResponseJson: result.rawResponseJson,
        outputCharCount: result.text.length,
        externalResponseId: readProviderResponseId(result.rawResponseJson),
        completedAt: new Date().toISOString(),
      });
      this.deps.responseObserver.recordSuccess({
        orgId: input.orgId,
        provider: owner,
        requestId,
        executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND,
        startedAt,
        action: "response_created",
      });
      this.deps.requestStore.settleUsage({
        orgId: input.orgId, requestId, provider: owner, rawResponseJson: result.rawResponseJson,
        inputCharCount: promptChars, outputCharCount: result.text.length,
      });
      return { ...result, requestId };
    } catch (error) {
      this.deps.responseObserver.recordFailure({
        orgId: input.orgId,
        provider: owner,
        requestId,
        executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND,
        startedAt,
        inputCharCount: promptChars,
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
      recordObservedRateLimit(this.deps.rateLimitRegistry, input.orgId, execution.provider, execution.provider.model, result.rateLimitState);
      for await (const event of result.events) {
        if (event.type === "error") throw new Error(event.textDelta ?? "Provider stream failed.");
        rawEvents.push(event.rawEventJson);
        if (event.type === "usage") continue;
        if (event.providerResponseId) providerResponseId = event.providerResponseId;
        if (event.textDelta) textParts.push(event.textDelta);
        const responseText = textParts.join("");
        const streamEventCount = rawEvents.length;
        const stillOpen = this.deps.requestStore.markStreaming({
          orgId: input.orgId,
          requestId,
          responseText,
          rawResponseJson: JSON.stringify(rawEvents),
          outputCharCount: responseText.length,
          streamEventCount,
          externalResponseId: providerResponseId,
        });
        if (!stillOpen) {
          console.info(`[provider-stream] request ${requestId} was cancelled; ignoring the rest of the stream`);
          return requestId;
        }
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
      const finished = this.deps.requestStore.markSucceeded({
        orgId: input.orgId,
        requestId,
        responseText,
        rawResponseJson: JSON.stringify(rawEvents),
        outputCharCount: responseText.length,
        externalResponseId: providerResponseId,
        completedAt: new Date().toISOString(),
      });
      if (!finished) return requestId;
      this.deps.responseObserver.recordSuccess({
        orgId: input.orgId,
        provider: execution.provider,
        requestId,
        executionMode: execution.executionMode,
        startedAt,
        action: "response_streamed",
      });
      this.deps.requestStore.settleUsage({
        orgId: input.orgId, requestId, provider: execution.provider, rawResponseJson: JSON.stringify(rawEvents),
        inputCharCount: execution.prompt.length, outputCharCount: responseText.length,
      });
      return requestId;
    } catch (error) {
      this.deps.responseObserver.recordFailure({
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
    const request = this.deps.requestStore.loadCancellationRow(input.orgId, input.requestId);
    if (request.state !== PROVIDER_REQUEST_STATE.PENDING && request.state !== PROVIDER_REQUEST_STATE.STREAMING) {
      throw new Error(`Provider request cannot be cancelled from state ${request.state}.`);
    }
    const providerResponseId = input.providerResponseId?.trim() || request.external_response_id;
    if (!providerResponseId) throw new Error("Provider response id is required.");
    const provider = loadConfiguredProvider(this.deps.db, input.orgId, request.provider_id);
    const adapter = requireAdapter(this.deps.adapters, provider.provider_key, provider.auth_type);
    const credential = loadCredential(this.deps.authBroker, input.orgId, provider);
    const authProfile = adapter.parseAuthProfile(credential.secret);
    const result = await adapter.cancelResponse({ authProfile, responseId: providerResponseId });
    recordObservedRateLimit(this.deps.rateLimitRegistry, input.orgId, provider, provider.model, result.rateLimitState);
    this.deps.requestStore.markCancelled({
      orgId: input.orgId,
      requestId: input.requestId,
      rawResponseJson: result.rawResponseJson,
      externalResponseId: providerResponseId,
      cancelledAt: new Date().toISOString(),
    });
    recordProviderHealth(this.deps.db, provider.id, input.orgId, HEALTH_STATE_HEALTHY, null);
    this.deps.audit.record({
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
    const provider = loadConfiguredProvider(this.deps.db, input.orgId, input.providerId);
    const workspaceId = this.normalizeWorkspaceId(input.orgId, input.workspaceId ?? null);
    const executionMode = input.executionMode ?? PROVIDER_EXECUTION_MODE.FOREGROUND;
    this.enforcePolicy(input.orgId, provider, executionMode, workspaceId);
    if (provider.auth_type !== PROVIDER_AUTH_TYPE.API_KEY) {
      throw new Error("Provider response execution requires an API key adapter.");
    }
    if (!provider.model) throw new Error("Provider model is required.");
    return {
      orgId: input.orgId,
      workspaceId,
      prompt,
      instructions: input.instructions?.trim() || null,
      executionMode,
      provider: { ...provider, model: provider.model },
      adapter: requireAdapter(this.deps.adapters, provider.provider_key, provider.auth_type),
      credential: loadCredential(this.deps.authBroker, input.orgId, provider),
    };
  }

  private createRequestRecord(execution: PreparedProviderExecution): string {
    return this.deps.requestStore.create({
      orgId: execution.orgId,
      provider: execution.provider,
      model: execution.provider.model,
      workspaceId: execution.workspaceId,
      promptSha256: hashPrompt(execution.prompt),
      inputCharCount: execution.prompt.length,
      executionMode: execution.executionMode,
      createdAt: new Date().toISOString(),
    });
  }

  private enforcePolicy(orgId: string, provider: ProviderRow, executionMode: ProviderExecutionMode, workspaceId: string | null): void {
    if (!Object.values(PROVIDER_EXECUTION_MODE).includes(executionMode)) throw new Error("Provider execution mode is invalid.");
    if (!WORKSPACE_SCOPES.has(provider.workspace_scope)) throw new Error("Provider workspace scope is invalid.");
    if (provider.workspace_scope === "workspace" && !workspaceId) {
      throw new Error("Provider workspace scope requires a workspace context.");
    }
    if (executionMode === PROVIDER_EXECUTION_MODE.BACKGROUND && provider.data_policy === PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION) {
      throw new Error("Background execution conflicts with zero data retention policy.");
    }
    if (executionMode === PROVIDER_EXECUTION_MODE.BACKGROUND && !this.deps.operations.isFeatureEnabled(orgId, FEATURE_FLAG_KEY.PROVIDER_BACKGROUND_EXECUTION)) {
      throw new Error("Provider background execution is disabled by feature flag.");
    }
    if (executionMode === PROVIDER_EXECUTION_MODE.BACKGROUND && provider.background_enabled !== 1) {
      throw new Error("Background execution is disabled for this provider policy.");
    }
    const window = currentProviderUsageWindow();
    const usage = this.deps.db.prepare(`
      select request_count
      from provider_usage_windows
      where org_id = ? and provider_id = ? and window_start = ?
    `).get(orgId, provider.id, window.start) as { request_count: number } | undefined;
    const requestCount = usage?.request_count ?? 0;
    if (requestCount >= provider.monthly_request_limit) throw new Error(PROVIDER_MONTHLY_LIMIT_MESSAGE);
  }

  private normalizeWorkspaceId(orgId: string, workspaceId: string | null): string | null {
    const normalized = workspaceId?.trim() || null;
    if (!normalized) return null;
    const workspace = this.deps.db.prepare("select id from workspaces where id = ? and org_id = ?")
      .get(normalized, orgId) as { id: string } | undefined;
    if (!workspace) throw new Error("Provider workspace context was not found.");
    return normalized;
  }
}

interface PreparedProviderExecution {
  orgId: string;
  workspaceId: string | null;
  prompt: string;
  instructions: string | null;
  executionMode: ProviderExecutionMode;
  provider: ProviderRow & { model: string };
  adapter: ProviderAdapterRegistry[string];
  credential: { secret: string };
}
