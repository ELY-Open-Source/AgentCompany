import type { ProviderAuthType } from "../../shared/domain";
import type { ProviderModelEntry } from "../../shared/provider-models";
import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";
import type { ProviderAuthProfile } from "./provider-auth-profiles";
import type { ProviderBackgroundCreateResult, ProviderBackgroundRetrieveResult } from "./provider-background";
import type { ProviderAuthorizeHandler, ProviderRefreshHandler, ProviderRevokeHandler } from "./provider-auth-lifecycle";
import type { ProviderCancelResult, ProviderStreamResult } from "./provider-streaming";

export interface ProviderExecutionInput {
  authProfile: ProviderAuthProfile;
  model: string;
  prompt: string;
  instructions: string | null;
}

export interface ProviderExecutionResult {
  text: string;
  rawResponseJson: string;
  rateLimitState: ProviderObservedRateLimitState | null;
}

export type ProviderStreamInput = ProviderExecutionInput;
export type ProviderBackgroundCreateInput = ProviderExecutionInput;

export interface ProviderCancelInput {
  authProfile: ProviderAuthProfile;
  responseId: string;
}

export interface ProviderBackgroundRetrieveInput {
  authProfile: ProviderAuthProfile;
  responseId: string;
}

export interface ProviderContext {
  authProfile: ProviderAuthProfile;
  model: string | null;
}

export interface ProviderRateLimitState {
  requestLimit: number | null;
  remainingRequests: number | null;
  resetAt: string | null;
  retryAfterMs: number | null;
  rawStateJson: string;
}

export interface ProviderAdapter {
  providerKey: string;
  authType: ProviderAuthType;
  authorize: ProviderAuthorizeHandler;
  refresh: ProviderRefreshHandler;
  revoke: ProviderRevokeHandler;
  parseAuthProfile(secret: string): ProviderAuthProfile;
  listModels(ctx: ProviderContext): Promise<ProviderModelEntry[]>;
  getRateLimitState(ctx: ProviderContext): Promise<ProviderRateLimitState | null>;
  streamResponse(input: ProviderStreamInput): Promise<ProviderStreamResult>;
  cancelResponse(input: ProviderCancelInput): Promise<ProviderCancelResult>;
  createBackgroundResponse(input: ProviderBackgroundCreateInput): Promise<ProviderBackgroundCreateResult>;
  retrieveResponse(input: ProviderBackgroundRetrieveInput): Promise<ProviderBackgroundRetrieveResult>;
  createResponse?: (input: ProviderExecutionInput) => Promise<ProviderExecutionResult>;
}

export type ProviderAdapterRegistry = Record<string, ProviderAdapter>;
