import type { ProviderAuthType } from "./domain";

export interface ProviderAuthProfileRecord {
  id: string;
  orgId: string;
  providerId: string;
  credentialId: string;
  providerKey: string;
  authType: ProviderAuthType;
  profileKind: string;
  displayHint: string;
  sourceType: string;
  sourceRef: string | null;
  capabilityJson: string;
  active: boolean;
  createdAt: string;
}

export interface ProviderAuthSessionRecord {
  id: string;
  orgId: string;
  providerId: string;
  providerKey: string;
  employeeId: string;
  state: string;
  nonce: string;
  codeVerifierSha256: string;
  redirectUri: string;
  signInUrl: string;
  partition: string;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}
