import type { IntegrationKeyStore } from "./integration-key-store";
import type { DatabaseSync } from "node:sqlite";
import type { CancelProviderResponseInput, CreateProviderResponseInput, StreamProviderResponseInput } from "../../shared/commands";
import { FEATURE_FLAG_KEY, PROVIDER_AUTH_TYPE, PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE, PROVIDER_REQUEST_STATE, type ProviderExecutionMode } from "../../shared/domain";
import type { ProviderStreamRendererEvent } from "../../shared/provider-request-domain";
import type { AuditService } from "./audit-service";
import type { AuthBrokerService } from "./auth-broker-service";
import type { OperationsService } from "./operations-service";
import type { ProviderAdapterRegistry } from "./provider-adapters";
import type { ProviderBackgroundService } from "./provider-background-service";
import type { ProviderRateLimitRegistry } from "./provider-rate-limit-registry";
import type { ProviderRequestStore, RequestPurpose } from "./provider-request-store";
import type { ProviderResponseObserver } from "./provider-response-observer";
import { hashPrompt, readProviderResponseId, requireStreamText } from "./provider-response-utils";
import { incompleteTurn, type AgentTurnMessage, type AgentTurnResult, type ToolDefinition, type ToolTurnFn } from "./provider-tool-turn";
import { selectToolTurn, supportsToolTurn } from "./provider-tool-turns/router";
import { resolveTurnCredential } from "./provider-tool-turns/credential-resolver";
import { currentRunId } from "./run-control";
import { budgetBlock, isPriced, promptChars, providerPrices } from "./spend";
import { assertModelSelectable, effectiveModel } from "./task-run-preparation";
import { modelCheckFailure, modelCheckProblem, modelCheckTurn, readModelCheck, recordModelCheck } from "./model-check";
import type { ModelCheckResult } from "../../shared/desktop-api";
import { isRecord, ProviderHttpError, readProviderErrorCode } from "./provider-http";
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
      // Read inside the request's try, so an unreadable credential is logged as this request's failure.
      const authProfile = execution.adapter.parseAuthProfile(loadCredential(this.deps.authBroker, execution.orgId, execution.provider).secret);
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
        inputCharCount: promptChars(execution.prompt, execution.instructions), outputCharCount: result.text.length,
      });
      return requestId;
    } catch (error) {
      this.deps.responseObserver.recordFailure({
        orgId: input.orgId,
        provider: execution.provider,
        requestId,
        executionMode: execution.executionMode,
        startedAt,
        inputCharCount: promptChars(execution.prompt, execution.instructions),
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
    /** A model chosen for this call (a goal auditor's), outside the session's pinned model and account. */
    model?: string;
    /** What the call is for, recorded with the request so a run's chain reads plainly. */
    purpose: "agent_turn" | "goal_audit";
  }): Promise<AgentTurnResult & { requestId: string }> {
    const provider = loadConfiguredProvider(this.deps.db, input.orgId, input.providerId);
    const workspaceId = this.normalizeWorkspaceId(input.orgId, input.workspaceId ?? null);
    if (!supportsToolTurn(provider.provider_key)) {
      throw new Error("Agent execution is not available for this provider; assign the agent an OpenAI, Anthropic, xAI, Groq, Mistral, Cerebras, OpenRouter, GPT account, GitHub Copilot, Google Antigravity, or Claude Pro provider.");
    }
    // A call made for a run works for its agent: the agent's model, its budget, its attribution.
    const taskRunId = currentRunId();
    const agent = taskRunId
      ? this.deps.db.prepare("select a.id, a.department, a.model_id from task_runs r join agents a on a.id = r.agent_id where r.id = ?").get(taskRunId) as { id: string; department: string; model_id: string | null }
      : null;
    const pins = taskRunId
      ? this.deps.db.prepare("select run_model, run_credential_id from task_runs where id = ?").get(taskRunId) as { run_model: string | null; run_credential_id: string | null }
      : null;
    const chosen = input.model ?? null;
    if (!chosen && pins?.run_credential_id && pins.run_credential_id !== provider.credential_id) {
      throw new Error("The provider's account was reconnected during this session; the next session continues with the new account.");
    }
    // Every turn of a session calls the model the session started with (checked then), whatever the configuration says now.
    if (chosen) assertModelSelectable(provider.provider_key, chosen, provider.model);
    else if (!pins?.run_model) assertModelSelectable(provider.provider_key, agent?.model_id ?? null, provider.model);
    const model = chosen ?? pins?.run_model ?? effectiveModel(agent?.model_id ?? null, provider.model);
    if (!model) throw new Error("Provider model is required.");
    const owner: ProviderRow & { model: string } = { ...provider, model };
    const turn = this.deps.toolTurn ?? selectToolTurn(provider.provider_key);
    const caller = { orgId: input.orgId, owner, workspaceId, agent, taskRunId, turn };
    const known = readModelCheck(this.deps.db, provider.id, model, requireCredentialId(provider));
    const problem = known ? (known.passed ? null : known.detail) : await this.probeModel(caller);
    if (problem) throw new Error(modelCheckFailure(provider.provider_key, model, problem));
    return this.callTurn(caller, { instructions: input.instructions, messages: input.messages, tools: input.tools }, input.purpose);
  }

  /** Probes a model for agent work and remembers the verdict; a request that fails records nothing. */
  private async probeModel(caller: TurnCaller): Promise<string | null> {
    const probe = modelCheckTurn();
    const problem = modelCheckProblem(await this.callTurn(caller, probe, "model_check"), probe.code);
    const { owner } = caller;
    recordModelCheck(this.deps.db, { orgId: caller.orgId, providerId: owner.id, model: owner.model, credentialId: requireCredentialId(owner), problem, now: new Date() });
    console.info(`[model-check] ${owner.provider_key} ${owner.model}: ${problem ?? "passed"}`);
    return problem;
  }

  /** Runs the agent check of a provider's model now, replacing any earlier result. */
  async checkModel(input: { orgId: string; providerId: string; model: string }): Promise<ModelCheckResult> {
    const provider = loadConfiguredProvider(this.deps.db, input.orgId, input.providerId);
    if (!supportsToolTurn(provider.provider_key)) throw new Error("Agent execution is not available for this provider.");
    const model = input.model.trim();
    if (!model) throw new Error("A model is required.");
    assertModelSelectable(provider.provider_key, model, provider.model);
    const owner = { ...provider, model };
    const turn = this.deps.toolTurn ?? selectToolTurn(provider.provider_key);
    const problem = await this.probeModel({ orgId: input.orgId, owner, workspaceId: null, agent: null, taskRunId: null, turn });
    return problem === null ? { passed: true } : { passed: false, detail: problem };
  }

  private async callTurn(caller: TurnCaller, request: { instructions: string | null; messages: AgentTurnMessage[]; tools: ToolDefinition[] }, purpose: RequestPurpose): Promise<AgentTurnResult & { requestId: string }> {
    const { orgId, owner, workspaceId, agent, taskRunId, turn } = caller;
    const model = owner.model;
    // Every request, a probe or the work, passes the provider's policy and quota and the agent's budget.
    this.enforcePolicy(orgId, owner, PROVIDER_EXECUTION_MODE.FOREGROUND, workspaceId);
    const blocked = agent ? budgetBlock(this.deps.db, agent.id, isPriced(providerPrices(this.deps.db, owner.id)), new Date()) : null;
    if (blocked) throw new Error(blocked);
    // Everything the model reads: instructions, the conversation, and the tool definitions.
    const turnInputChars = (request.instructions?.length ?? 0) + JSON.stringify(request.messages).length + JSON.stringify(request.tools).length;
    const requestId = this.deps.requestStore.create({
      agentId: agent?.id ?? null,
      taskRunId,
      department: agent?.department ?? null,
      orgId,
      provider: owner,
      model,
      workspaceId,
      promptSha256: hashPrompt(JSON.stringify(request.messages)),
      inputCharCount: turnInputChars,
      executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND,
      createdAt: new Date().toISOString(),
      purpose,
    });
    const startedAt = Date.now();
    try {
      const credential = await resolveTurnCredential({ authBroker: this.deps.authBroker, integrationKeys: this.deps.integrationKeys, orgId, provider: owner });
      const result = await turn({ credential, model, instructions: request.instructions, messages: request.messages, tools: request.tools });
      recordObservedRateLimit(this.deps.rateLimitRegistry, orgId, owner, model, result.rateLimitState ?? null);
      // Tool calls are output the model wrote, as much as its text.
      const outputChars = result.text.length + (result.toolCalls.length > 0 ? JSON.stringify(result.toolCalls).length : 0);
      this.deps.requestStore.markSucceeded({
        orgId,
        requestId,
        responseText: result.text,
        rawResponseJson: result.rawResponseJson,
        outputCharCount: outputChars,
        externalResponseId: readProviderResponseId(result.rawResponseJson),
        completedAt: new Date().toISOString(),
      });
      this.deps.responseObserver.recordSuccess({
        orgId,
        provider: owner,
        requestId,
        executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND,
        startedAt,
        action: "response_created",
      });
      this.deps.requestStore.settleUsage({
        orgId, requestId, provider: owner, rawResponseJson: result.rawResponseJson,
        inputCharCount: turnInputChars, outputCharCount: outputChars,
      });
      return { ...result, requestId };
    } catch (error) {
      this.deps.responseObserver.recordFailure({
        orgId,
        provider: owner,
        requestId,
        executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND,
        startedAt,
        inputCharCount: turnInputChars,
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
    let finished = false;
    try {
      // Read inside the request's try, so an unreadable credential is logged as this request's failure.
      const authProfile = execution.adapter.parseAuthProfile(loadCredential(this.deps.authBroker, execution.orgId, execution.provider).secret);
      const result = await execution.adapter.streamResponse({
        authProfile,
        model: execution.provider.model,
        prompt: execution.prompt,
        instructions: execution.instructions,
      });
      recordObservedRateLimit(this.deps.rateLimitRegistry, input.orgId, execution.provider, execution.provider.model, result.rateLimitState);
      for await (const event of result.events) {
        if (event.type === "error") {
          const failure = streamErrorFields(event.rawEventJson);
          throw new ProviderHttpError(event.textDelta ?? "Provider stream failed.", null, failure.status, false, failure.code);
        }
        rawEvents.push(event.rawEventJson);
        if (event.type === "usage") continue;
        if (event.type === "message_stop") finished = true;
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
      if (!finished) throw incompleteTurn(null);
      const responseText = requireStreamText(textParts);
      const succeeded = this.deps.requestStore.markSucceeded({
        orgId: input.orgId,
        requestId,
        responseText,
        rawResponseJson: JSON.stringify(rawEvents),
        outputCharCount: responseText.length,
        externalResponseId: providerResponseId,
        completedAt: new Date().toISOString(),
      });
      if (!succeeded) return requestId;
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
        inputCharCount: promptChars(execution.prompt, execution.instructions), outputCharCount: responseText.length,
      });
      return requestId;
    } catch (error) {
      this.deps.responseObserver.recordFailure({
        orgId: input.orgId,
        provider: execution.provider,
        requestId,
        executionMode: execution.executionMode,
        startedAt,
        inputCharCount: promptChars(execution.prompt, execution.instructions),
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
    };
  }

  private createRequestRecord(execution: PreparedProviderExecution): string {
    return this.deps.requestStore.create({
      orgId: execution.orgId,
      provider: execution.provider,
      model: execution.provider.model,
      workspaceId: execution.workspaceId,
      promptSha256: hashPrompt(execution.prompt),
      inputCharCount: promptChars(execution.prompt, execution.instructions),
      executionMode: execution.executionMode,
      createdAt: new Date().toISOString(),
      purpose: "manual",
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
    this.deps.requestStore.assertMonthlyCapacity(orgId, provider);
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
}

interface TurnCaller {
  orgId: string;
  owner: ProviderRow & { model: string };
  workspaceId: string | null;
  agent: { id: string; department: string } | null;
  taskRunId: string | null;
  turn: ToolTurnFn;
}

function requireCredentialId(provider: ProviderRow): string {
  if (!provider.credential_id) throw new Error("Provider credential is required.");
  return provider.credential_id;
}

/** A stream error event's status (a numeric error code, as OpenRouter and Google send) and provider code. */
function streamErrorFields(rawEventJson: string): { status: number | null; code: string | null } {
  const data = JSON.parse(rawEventJson) as unknown;
  if (!isRecord(data)) return { status: null, code: null };
  const error = data.error ?? (isRecord(data.response) ? data.response.error : undefined);
  const status = isRecord(error) && typeof error.code === "number" ? error.code : null;
  return { status, code: readProviderErrorCode({ error }) ?? (typeof data.code === "string" ? data.code : null) };
}
