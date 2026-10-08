export const INTEGRATION_KEY_NAMES = ["composio", "logo_dev", "google_antigravity_client_secret"] as const;

export type IntegrationKeyName = (typeof INTEGRATION_KEY_NAMES)[number];

export interface IntegrationKeyStatus {
  name: IntegrationKeyName;
  configured: boolean;
  updatedAt: string | null;
}

export interface SetIntegrationKeyInput {
  name: IntegrationKeyName;
  value: string;
}

export interface ClearIntegrationKeyInput {
  name: IntegrationKeyName;
}
