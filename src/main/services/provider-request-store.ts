import type { DatabaseSync } from "node:sqlite";
import { PROVIDER_EXECUTION_MODE, PROVIDER_REQUEST_STATE, type ProviderExecutionMode } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { providerPrices, readTokenUsage, requestCostCents, type TokenUsage } from "./spend";

/** Providers already logged as not reporting token usage. */
const providersWithoutUsage = new Set<string>();
import { currentProviderUsageWindow, PROVIDER_MONTHLY_LIMIT_MESSAGE } from "../../shared/provider-runtime-domain";

export interface ProviderRequestOwner {
  id: string;
  provider_key: string;
  data_policy: string;
  workspace_scope: string;
}

export interface CreateProviderRequestInput {
  orgId: string;
  provider: ProviderRequestOwner;
  model: string;
  workspaceId: string | null;
  promptSha256: string;
  inputCharCount: number;
  executionMode: ProviderExecutionMode;
  createdAt: string;
  /** The agent and task run the call works for, when it is part of a run. */
  agentId?: string | null;
  taskRunId?: string | null;
  /** The agent's department at call time, which its spend is charged to. */
  department?: string | null;
}

export interface ProviderRequestProgressInput {
  orgId: string;
  requestId: string;
  responseText: string;
  rawResponseJson: string;
  outputCharCount: number;
  streamEventCount: number;
  externalResponseId: string | null;
}

export interface ProviderBackgroundAcceptedInput {
  orgId: string;
  requestId: string;
  rawResponseJson: string;
  externalResponseId: string;
}

export interface ProviderBackgroundProgressInput {
  orgId: string;
  requestId: string;
  rawResponseJson: string;
  externalResponseId: string;
  state: typeof PROVIDER_REQUEST_STATE.PENDING | typeof PROVIDER_REQUEST_STATE.STREAMING;
}

export interface ProviderRequestResultInput {
  orgId: string;
  requestId: string;
  responseText: string;
  rawResponseJson: string;
  outputCharCount: number;
  externalResponseId: string | null;
  completedAt: string;
}

export interface ProviderRequestFailureInput {
  orgId: string;
  requestId: string;
  errorMessage: string;
  completedAt: string;
  rawResponseJson?: string | null;
}

export interface ProviderRequestCancellationInput {
  orgId: string;
  requestId: string;
  rawResponseJson: string;
  externalResponseId: string;
  cancelledAt: string;
}

export interface ProviderCancellationRow {
  id: string;
  org_id: string;
  provider_id: string;
  provider_key: string;
  model: string;
  state: string;
  external_response_id: string | null;
}

export interface ProviderBackgroundRequestRow {
  id: string;
  org_id: string;
  provider_id: string;
  provider_key: string;
  model: string;
  state: string;
  external_response_id: string;
  input_char_count: number;
  execution_mode: ProviderExecutionMode;
}

export class ProviderRequestStore {
  constructor(private readonly db: DatabaseSync) {}

  create(input: CreateProviderRequestInput): string {
    const requestId = createId("preq");
    this.db.prepare(`
      insert into provider_requests(
        id, org_id, provider_id, provider_key, workspace_id, model, prompt_sha256,
        response_text, raw_response_json, state, error_message, input_char_count,
        output_char_count, execution_mode, policy_decision, external_response_id,
        stream_event_count, cancelled_at, created_at, completed_at, agent_id, task_run_id, department
      )
      values (?, ?, ?, ?, ?, ?, ?, null, null, ?, null, ?, 0, ?, ?, null, 0, null, ?, null, ?, ?, ?)
    `).run(
      requestId,
      input.orgId,
      input.provider.id,
      input.provider.provider_key,
      input.workspaceId,
      input.model,
      input.promptSha256,
      PROVIDER_REQUEST_STATE.PENDING,
      input.inputCharCount,
      input.executionMode,
      policyDecision(input.provider, input.workspaceId),
      input.createdAt,
      input.agentId ?? null,
      input.taskRunId ?? null,
      input.department ?? null,
    );
    return requestId;
  }

  /** Records the tokens a call used and what it cost (null when its provider has no prices). */
  recordSpend(requestId: string, usage: TokenUsage, costCents: number | null): void {
    this.db.prepare(`
      update provider_requests set input_tokens = ?, output_tokens = ?, cached_input_tokens = ?, reasoning_tokens = ?, cost_cents = ?
      where id = ?
    `).run(usage.inputTokens, usage.outputTokens, usage.cachedInputTokens, usage.reasoningTokens, costCents, requestId);
  }

  /** Terminal states (succeeded, failed, cancelled) are final: these transitions return false once one is reached. */
  markStreaming(input: ProviderRequestProgressInput): boolean {
    return this.db.prepare(`
      update provider_requests
      set state = ?, response_text = ?, raw_response_json = ?, output_char_count = ?,
        stream_event_count = ?, external_response_id = coalesce(?, external_response_id)
      where id = ? and org_id = ? and state not in ('succeeded', 'failed', 'cancelled')
    `).run(
      PROVIDER_REQUEST_STATE.STREAMING,
      input.responseText,
      input.rawResponseJson,
      input.outputCharCount,
      input.streamEventCount,
      input.externalResponseId,
      input.requestId,
      input.orgId,
    ).changes === 1;
  }

  markBackgroundAccepted(input: ProviderBackgroundAcceptedInput): boolean {
    return this.db.prepare(`
      update provider_requests
      set state = ?, raw_response_json = ?, external_response_id = ?
      where id = ? and org_id = ? and state not in ('succeeded', 'failed', 'cancelled')
    `).run(
      PROVIDER_REQUEST_STATE.PENDING,
      input.rawResponseJson,
      input.externalResponseId,
      input.requestId,
      input.orgId,
    ).changes === 1;
  }

  /** Counts a failed status check on a background request and returns how many happened in a row. */
  recordPollFailure(requestId: string, message: string): number {
    this.db.prepare("update provider_requests set poll_failures = poll_failures + 1, last_poll_error = ? where id = ?").run(message, requestId);
    return (this.db.prepare("select poll_failures from provider_requests where id = ?").get(requestId) as { poll_failures: number }).poll_failures;
  }

  clearPollFailures(requestId: string): void {
    this.db.prepare("update provider_requests set poll_failures = 0, last_poll_error = null where id = ?").run(requestId);
  }

  markBackgroundProgress(input: ProviderBackgroundProgressInput): boolean {
    return this.db.prepare(`
      update provider_requests
      set state = ?, raw_response_json = ?, external_response_id = ?
      where id = ? and org_id = ? and state not in ('succeeded', 'failed', 'cancelled')
    `).run(input.state, input.rawResponseJson, input.externalResponseId, input.requestId, input.orgId).changes === 1;
  }

  markSucceeded(input: ProviderRequestResultInput): boolean {
    return this.db.prepare(`
      update provider_requests
      set state = ?, response_text = ?, raw_response_json = ?, output_char_count = ?,
        external_response_id = coalesce(?, external_response_id), completed_at = ?
      where id = ? and org_id = ? and state not in ('succeeded', 'failed', 'cancelled')
    `).run(
      PROVIDER_REQUEST_STATE.SUCCEEDED,
      input.responseText,
      input.rawResponseJson,
      input.outputCharCount,
      input.externalResponseId,
      input.completedAt,
      input.requestId,
      input.orgId,
    ).changes === 1;
  }

  markFailed(input: ProviderRequestFailureInput): boolean {
    return this.db.prepare(`
      update provider_requests
      set state = ?, error_message = ?, raw_response_json = coalesce(?, raw_response_json), completed_at = ?
      where id = ? and org_id = ? and state not in ('succeeded', 'failed', 'cancelled')
    `).run(PROVIDER_REQUEST_STATE.FAILED, input.errorMessage, input.rawResponseJson ?? null, input.completedAt, input.requestId, input.orgId).changes === 1;
  }

  markCancelled(input: ProviderRequestCancellationInput): void {
    this.db.prepare(`
      update provider_requests
      set state = ?, raw_response_json = ?, external_response_id = ?, cancelled_at = ?, completed_at = ?, error_message = null
      where id = ? and org_id = ?
    `).run(
      PROVIDER_REQUEST_STATE.CANCELLED,
      input.rawResponseJson,
      input.externalResponseId,
      input.cancelledAt,
      input.cancelledAt,
      input.requestId,
      input.orgId,
    );
  }

  loadCancellationRow(orgId: string, requestId: string): ProviderCancellationRow {
    const request = this.db.prepare(`
      select id, org_id, provider_id, provider_key, model, state, external_response_id
      from provider_requests
      where id = ? and org_id = ?
    `).get(requestId, orgId) as ProviderCancellationRow | undefined;
    if (!request) throw new Error("Provider request was not found.");
    return request;
  }

  listRecoverableBackgroundRequests(orgId?: string): ProviderBackgroundRequestRow[] {
    const sql = `
      select id, org_id, provider_id, provider_key, model, state, external_response_id, input_char_count, execution_mode
      from provider_requests
      where execution_mode = ?
        and state in (?, ?)
        and external_response_id is not null
        ${orgId ? "and org_id = ?" : ""}
      order by created_at asc
    `;
    return orgId
      ? this.db.prepare(sql).all(PROVIDER_EXECUTION_MODE.BACKGROUND, PROVIDER_REQUEST_STATE.PENDING, PROVIDER_REQUEST_STATE.STREAMING, orgId) as unknown as ProviderBackgroundRequestRow[]
      : this.db.prepare(sql).all(PROVIDER_EXECUTION_MODE.BACKGROUND, PROVIDER_REQUEST_STATE.PENDING, PROVIDER_REQUEST_STATE.STREAMING) as unknown as ProviderBackgroundRequestRow[];
  }

  loadBackgroundRequest(orgId: string, requestId: string): ProviderBackgroundRequestRow {
    const request = this.db.prepare(`
      select id, org_id, provider_id, provider_key, model, state, external_response_id, input_char_count, execution_mode
      from provider_requests
      where id = ? and org_id = ? and execution_mode = ? and external_response_id is not null
    `).get(requestId, orgId, PROVIDER_EXECUTION_MODE.BACKGROUND) as ProviderBackgroundRequestRow | undefined;
    if (!request) throw new Error("Provider background request was not found.");
    return request;
  }

  /** Refuses a call once finished plus in-flight calls reach the limit; callers create the request right after, before any await, as the reservation. */
  assertMonthlyCapacity(orgId: string, provider: { id: string; monthly_request_limit: number }): void {
    const window = currentProviderUsageWindow();
    const finished = this.db.prepare("select request_count from provider_usage_windows where org_id = ? and provider_id = ? and window_start = ?")
      .get(orgId, provider.id, window.start) as { request_count: number } | undefined;
    // Startup recovery fails requests a crash left open, so every open row here is a live reservation.
    const inFlight = this.db.prepare(`
      select count(*) as n from provider_requests
      where org_id = ? and provider_id = ? and state in (?, ?) and created_at >= ?
    `).get(orgId, provider.id, PROVIDER_REQUEST_STATE.PENDING, PROVIDER_REQUEST_STATE.STREAMING, window.start) as { n: number };
    if ((finished?.request_count ?? 0) + inFlight.n >= provider.monthly_request_limit) throw new Error(PROVIDER_MONTHLY_LIMIT_MESSAGE);
  }

  /** Settles a successful call: reads the provider's token usage, prices it, and adds it to the request and the month's totals. */
  settleUsage(input: { orgId: string; requestId: string; provider: { id: string; provider_key: string }; rawResponseJson: string; inputCharCount: number; outputCharCount: number }): void {
    const usage = readTokenUsage(input.rawResponseJson);
    if (!usage) {
      if (!providersWithoutUsage.has(input.provider.provider_key)) console.warn(`[spend] ${input.provider.provider_key} returned no token usage; its calls cost nothing on record.`);
      providersWithoutUsage.add(input.provider.provider_key);
      this.recordUsage(input.orgId, input.provider.id, input.inputCharCount, input.outputCharCount, null);
      return;
    }
    const costCents = requestCostCents(usage, providerPrices(this.db, input.provider.id));
    this.recordSpend(input.requestId, usage, costCents);
    this.recordUsage(input.orgId, input.provider.id, input.inputCharCount, input.outputCharCount, { usage, costCents });
  }

  /** Adds one call to the provider's monthly totals; spend is null when the provider reported no token usage. */
  recordUsage(orgId: string, providerId: string, inputCharCount: number, outputCharCount: number, spend: { usage: TokenUsage; costCents: number | null } | null): void {
    const window = currentProviderUsageWindow();
    const now = new Date().toISOString();
    const usage = spend?.usage;
    this.db.prepare(`
      insert into provider_usage_windows(
        id, org_id, provider_id, window_start, window_end, request_count,
        input_char_count, output_char_count, created_at, updated_at,
        input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, cost_cents, requests_without_usage, unpriced_requests
      ) values (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(provider_id, window_start) do update set
        request_count = request_count + 1,
        input_char_count = input_char_count + excluded.input_char_count,
        output_char_count = output_char_count + excluded.output_char_count,
        input_tokens = input_tokens + excluded.input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
        reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens,
        cost_cents = cost_cents + excluded.cost_cents,
        requests_without_usage = requests_without_usage + excluded.requests_without_usage,
        unpriced_requests = unpriced_requests + excluded.unpriced_requests,
        updated_at = excluded.updated_at
    `).run(
      createId("puw"), orgId, providerId, window.start, window.end, inputCharCount, outputCharCount, now, now,
      usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, usage?.cachedInputTokens ?? 0, usage?.reasoningTokens ?? 0,
      spend?.costCents ?? 0, spend ? 0 : 1, spend && spend.costCents === null ? 1 : 0,
    );
  }
}

function policyDecision(provider: ProviderRequestOwner, workspaceId: string | null): string {
  if (provider.workspace_scope === "workspace") return `allowed:${provider.data_policy}:workspace:${workspaceId}`;
  return `allowed:${provider.data_policy}:organization`;
}
