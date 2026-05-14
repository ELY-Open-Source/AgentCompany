import type {
  ApiKeyValue,
  AwsCredential,
  AzureCredential,
  GcpAdcCredential,
  LocalCredential,
} from "@shared/contracts/schemas-credentials";

/**
 * pi-ai's `OAuthCredentials` shape.
 *
 * Mirrored locally as a type-only declaration to avoid pulling pi runtime
 * symbols into modules that only need the shape. The actual contract is
 * enforced by pi at runtime via the OAuth provider interface.
 */
export interface OAuthCredentialPayload {
  refresh: string;
  access: string;
  expires: number;
  /** Provider-specific extra fields (e.g. github copilot domain) */
  [key: string]: unknown;
}

export type StoredCredentialPayload =
  | { kind: "oauth"; value: OAuthCredentialPayload }
  | { kind: "api_key"; value: ApiKeyValue }
  | { kind: "azure"; value: AzureCredential }
  | { kind: "aws"; value: AwsCredential }
  | { kind: "gcp_adc"; value: GcpAdcCredential }
  | { kind: "local"; value: LocalCredential };

export type CredentialKind = StoredCredentialPayload["kind"];
