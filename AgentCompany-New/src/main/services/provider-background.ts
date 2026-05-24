import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";

export interface ProviderBackgroundCreateResult {
  responseId: string;
  status: string;
  rawResponseJson: string;
  rateLimitState: ProviderObservedRateLimitState | null;
}

export interface ProviderBackgroundRetrieveResult {
  responseId: string;
  status: string;
  text: string | null;
  rawResponseJson: string;
  rateLimitState: ProviderObservedRateLimitState | null;
}

export function backgroundUnsupported(providerLabel: string): () => Promise<ProviderBackgroundCreateResult> {
  return async () => {
    throw new Error(`${providerLabel} background execution is unavailable.`);
  };
}

export function retrieveUnsupported(providerLabel: string): () => Promise<ProviderBackgroundRetrieveResult> {
  return async () => {
    throw new Error(`${providerLabel} response retrieval is unavailable.`);
  };
}
