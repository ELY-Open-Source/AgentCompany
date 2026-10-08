export interface ConnectorCatalogEntry {
  authConfigId: string;
  slug: string;
  name: string;
  authScheme: string;
  logoUrl: string | null;
}

/** The label of a toolkit's first account, and of every account from before labels existed. */
export const DEFAULT_CONNECTOR_ACCOUNT_LABEL = "main";

export interface ConnectComposioToolkitInput {
  orgId: string;
  toolkitSlug: string;
  /** The account to connect or reconnect; a new label adds another account of the toolkit. */
  label: string;
}

export interface ConnectComposioToolkitResult {
  accountId: string;
  redirectUrl: string | null;
}

export interface DisconnectComposioToolkitInput {
  orgId: string;
  toolkitSlug: string;
  label: string;
}

export interface GrantConnectorInput {
  orgId: string;
  agentId: string;
  toolkitSlug: string;
  accountLabel: string;
  employeeId: string;
}

export interface RevokeConnectorInput {
  orgId: string;
  agentId: string;
  toolkitSlug: string;
}

export interface RefreshComposioAccountsInput {
  orgId: string;
}
