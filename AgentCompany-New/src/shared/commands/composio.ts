export interface SaveComposioSettingsInput {
  orgId: string;
  apiKey: string;
  toolkits: string[];
}

export interface ComposioToolkitSummaryDto {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  categories: string[];
  authSchemes: string[];
  noAuth: boolean;
  toolsCount: number;
}

export interface ListComposioToolkitsInput {
  orgId: string;
}

export interface ConnectComposioToolkitInput {
  orgId: string;
  toolkitSlug: string;
  toolkitName: string;
}

export interface ConnectComposioToolkitResult {
  accountId: string;
  status: string;
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
