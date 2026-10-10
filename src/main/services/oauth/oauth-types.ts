/**
 * Shared types for the native provider OAuth login flows.
 *
 * These flows obtain real provider credentials through the providers' official
 * device-code / authorization-code (PKCE) processes. The resulting credentials
 * are stored as JSON via the existing secret vault so a token can be extracted
 * for requests and a refresh token retained for future renewal.
 */

export interface OAuthCredentials {
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
}

export interface OAuthLoginCallbacks {
  /** Called once the authorization URL is ready; `userCode` is the device-flow code the user enters, null for a browser redirect. */
  onAuth: (info: { url: string; userCode: string | null }) => void;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
  /** GitHub Enterprise domain for Copilot; null/empty means github.com. */
  enterpriseDomain?: string | null;
}

export interface OAuthFlow {
  providerKey: string;
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
}
