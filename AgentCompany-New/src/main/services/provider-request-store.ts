import type { DatabaseSync } from "node:sqlite";
import { PROVIDER_REQUEST_STATE, type ProviderExecutionMode } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { currentProviderUsageWindow } from "../../shared/provider-runtime-domain";

export interface ProviderRequestOwner {
  id: string;
  provider_key: string;
  data_policy: string;
}

export interface CreateProviderRequestInput {
  orgId: string;
  provider: ProviderRequestOwner;
  model: string;
  promptSha256: string;
  inputCharCount: number;
  executionMode: ProviderExecutionMode;
  createdAt: string;
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

export class ProviderRequestStore {
  constructor(private readonly db: DatabaseSync) {}

  create(input: CreateProviderRequestInput): string {
    const requestId = createId("preq");
    this.db.prepare(`
      insert into provider_requests(
        id, org_id, provider_id, provider_key, model, prompt_sha256,
        response_text, raw_response_json, state, error_message, input_char_count,
        output_char_count, execution_mode, policy_decision, external_response_id,
        stream_event_count, cancelled_at, created_at, completed_at
      )
      values (?, ?, ?, ?, ?, ?, null, null, ?, null, ?, 0, ?, ?, null, 0, null, ?, null)
    `).run(
      requestId,
      input.orgId,
      input.provider.id,
      input.provider.provider_key,
      input.model,
      input.promptSha256,
      PROVIDER_REQUEST_STATE.PENDING,
      input.inputCharCount,
      input.executionMode,
      `allowed:${input.provider.data_policy}`,
      input.createdAt,
    );
    return requestId;
  }

  markStreaming(input: ProviderRequestProgressInput): void {
    this.db.prepare(`
      update provider_requests
      set state = ?, response_text = ?, raw_response_json = ?, output_char_count = ?,
        stream_event_count = ?, external_response_id = coalesce(?, external_response_id)
      where id = ? and org_id = ?
    `).run(
      PROVIDER_REQUEST_STATE.STREAMING,
      input.responseText,
      input.rawResponseJson,
      input.outputCharCount,
      input.streamEventCount,
      input.externalResponseId,
      input.requestId,
      input.orgId,
    );
  }

  markSucceeded(input: ProviderRequestResultInput): void {
    this.db.prepare(`
      update provider_requests
      set state = ?, response_text = ?, raw_response_json = ?, output_char_count = ?,
        external_response_id = coalesce(?, external_response_id), completed_at = ?
      where id = ? and org_id = ?
    `).run(
      PROVIDER_REQUEST_STATE.SUCCEEDED,
      input.responseText,
      input.rawResponseJson,
      input.outputCharCount,
      input.externalResponseId,
      input.completedAt,
      input.requestId,
      input.orgId,
    );
  }

  markFailed(input: ProviderRequestFailureInput): void {
    this.db.prepare(`
      update provider_requests
      set state = ?, error_message = ?, completed_at = ?
      where id = ? and org_id = ?
    `).run(PROVIDER_REQUEST_STATE.FAILED, input.errorMessage, input.completedAt, input.requestId, input.orgId);
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

  recordUsage(orgId: string, providerId: string, inputCharCount: number, outputCharCount: number): void {
    const window = currentProviderUsageWindow();
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
