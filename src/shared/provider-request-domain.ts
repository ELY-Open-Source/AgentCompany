import type { ProviderExecutionMode } from "./provider-policy-domain";

export const PROVIDER_REQUEST_STATE = {
  PENDING: "pending",
  STREAMING: "streaming",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type ProviderRequestState = typeof PROVIDER_REQUEST_STATE[keyof typeof PROVIDER_REQUEST_STATE];

/**
 * Snapshot projection of a provider request. The raw provider response body
 * stays in the database (task_runs diagnostics read it there) — shipping it
 * to the renderer ballooned every snapshot by megabytes for nothing.
 */
export interface ProviderRequestRecord {
  id: string;
  orgId: string;
  providerId: string;
  providerKey: string;
  workspaceId: string | null;
  model: string;
  promptSha256: string;
  responseText: string | null;
  state: ProviderRequestState;
  errorMessage: string | null;
  inputCharCount: number;
  outputCharCount: number;
  executionMode: ProviderExecutionMode;
  policyDecision: string;
  externalResponseId: string | null;
  streamEventCount: number;
  cancelledAt: string | null;
  createdAt: string;
  completedAt: string | null;
  agentId: string | null;
  taskRunId: string | null;
  /** Provider-reported token usage; null when the provider reported none. */
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  /** Null when the provider has no prices or reported no usage. */
  costCents: number | null;
}

export interface ProviderStreamRendererEvent {
  requestId: string;
  providerId: string;
  providerKey: string;
  model: string;
  streamEventType: "message_start" | "text_delta" | "message_stop" | "error" | "usage";
  textDelta: string | null;
  responseText: string;
  providerResponseId: string | null;
  rawEventJson: string;
  streamEventCount: number;
}
