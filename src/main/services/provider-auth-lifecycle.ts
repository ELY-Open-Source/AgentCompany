import type { ProviderAuthProfile } from "./provider-adapters";

export interface ProviderAuthorizeInput {
  secret: string;
}

export interface ProviderAuthorizeResult {
  authProfile: ProviderAuthProfile;
}

export interface ProviderRefreshInput {
  authProfile: ProviderAuthProfile;
}

export interface ProviderRefreshResult {
  authProfile: ProviderAuthProfile;
  rotatedSecret: string | null;
  refreshedAt: string;
}

export type ProviderAuthorizeHandler = (input: ProviderAuthorizeInput) => Promise<ProviderAuthorizeResult>;
export type ProviderRefreshHandler = (input: ProviderRefreshInput) => Promise<ProviderRefreshResult>;

export function authorizeWithParser(parseAuthProfile: (secret: string) => ProviderAuthProfile): ProviderAuthorizeHandler {
  return async (input) => ({ authProfile: parseAuthProfile(input.secret) });
}

export function refreshUnsupported(label: string): ProviderRefreshHandler {
  return async () => {
    throw new Error(`${label} does not support token refresh.`);
  };
}
