export interface ConnectorCatalogEntry {
  authConfigId: string;
  slug: string;
  name: string;
  authScheme: string;
  logoUrl: string | null;
}

export interface ConnectComposioToolkitInput {
  orgId: string;
  toolkitSlug: string;
}

export interface ConnectComposioToolkitResult {
  accountId: string;
  redirectUrl: string | null;
}

export interface RefreshComposioAccountsInput {
  orgId: string;
}

export interface ConnectorGrantInput {
  orgId: string;
  agentId: string;
  toolkitSlug: string;
  employeeId: string;
}
