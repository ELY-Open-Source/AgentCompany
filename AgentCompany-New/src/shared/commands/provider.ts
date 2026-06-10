import type { ProviderDataPolicy, ProviderExecutionMode } from "../domain";

export interface SaveProviderCredentialInput {
  orgId: string;
  providerId: string;
  secret: string;
  model: string | null;
  employeeId?: string | null;
}

export interface RevokeProviderCredentialInput {
  orgId: string;
  providerId: string;
}

export interface LaunchProviderSignInInput {
  orgId: string;
  providerId: string;
  employeeId: string;
}

export interface StartProviderOAuthInput {
  providerKey: string;
  enterpriseDomain?: string | null;
  /** Present when connecting an existing org's provider (Settings); absent
   * during onboarding, where the obtained credential is returned to the caller. */
  orgId?: string;
  providerId?: string;
  employeeId?: string;
  model?: string | null;
}

export interface StartProviderOAuthResult {
  /** The obtained credential JSON when no org context was supplied, else null
   * (the credential was already stored). */
  secret: string | null;
}

export interface CancelProviderOAuthInput {
  providerKey: string;
}

export interface CheckProviderHealthInput {
  orgId: string;
  providerId: string;
}

export interface ListProviderModelsInput {
  providerKey: string;
  /** A just-typed/authorized credential (onboarding or the connect-new dialog). */
  secret?: string;
  /** A stored provider whose secret is decrypted server-side (settings refresh). */
  orgId?: string;
  providerId?: string;
}

export interface UpdateProviderPolicyInput {
  orgId: string;
  providerId: string;
  dataPolicy: ProviderDataPolicy;
  backgroundEnabled: boolean;
  monthlyRequestLimit: number;
  workspaceScope: "organization" | "workspace";
}

export interface CreateProviderResponseInput {
  orgId: string;
  providerId: string;
  workspaceId?: string | null;
  prompt: string;
  instructions: string | null;
  executionMode?: ProviderExecutionMode;
}

export type StreamProviderResponseInput = CreateProviderResponseInput;

export interface CancelProviderResponseInput {
  orgId: string;
  requestId: string;
  providerResponseId?: string;
}
