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

export interface ProviderRevokeInput {
  authProfile: ProviderAuthProfile;
  /** The stored credential, for providers that revoke with the refresh token. */
  secret: string;
}

export type ProviderAuthorizeHandler = (input: ProviderAuthorizeInput) => Promise<ProviderAuthorizeResult>;
export type ProviderRefreshHandler = (input: ProviderRefreshInput) => Promise<ProviderRefreshResult>;
export type ProviderRevokeHandler = (input: ProviderRevokeInput) => Promise<void>;

export function authorizeWithParser(parseAuthProfile: (secret: string) => ProviderAuthProfile): ProviderAuthorizeHandler {
  return async (input) => ({ authProfile: parseAuthProfile(input.secret) });
}

export function refreshUnsupported(label: string): ProviderRefreshHandler {
  return async () => {
    throw new Error(`${label} does not support token refresh.`);
  };
}

export function revokeLocalProfile(assertProfile: (profile: ProviderAuthProfile) => void): ProviderRevokeHandler {
  return async (input) => {
    assertProfile(input.authProfile);
  };
}
