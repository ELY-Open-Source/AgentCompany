import type { ProviderExecutionMode } from "./provider-policy-domain";

export const PROVIDER_REQUEST_STATE = {
  PENDING: "pending",
  STREAMING: "streaming",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type ProviderRequestState = typeof PROVIDER_REQUEST_STATE[keyof typeof PROVIDER_REQUEST_STATE];

export interface ProviderRequestRecord {
  id: string;
  orgId: string;
  providerId: string;
  providerKey: string;
  model: string;
  promptSha256: string;
  responseText: string | null;
  rawResponseJson: string | null;
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
}

export interface ProviderStreamRendererEvent {
  requestId: string;
  providerId: string;
  providerKey: string;
  model: string;
  streamEventType: "message_start" | "text_delta" | "message_stop" | "error";
  textDelta: string | null;
  responseText: string;
  providerResponseId: string | null;
  rawEventJson: string;
  streamEventCount: number;
}
