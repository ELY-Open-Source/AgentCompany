import { CONNECTORS, type ConnectorDefinition } from "./connector-definitions";

export function findConnectorDefinition(id: string): ConnectorDefinition | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}

export function listFeaturedOnboardingConnectors(): ConnectorDefinition[] {
  return CONNECTORS.filter((connector) => connector.onboardingFeatured === true);
}
