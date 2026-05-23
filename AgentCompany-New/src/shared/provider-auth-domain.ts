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
