import type { ConnectorCatalogEntry } from "@shared/connector-catalog";
import type { CredentialSummary } from "@shared/contracts/schemas-credentials";
import type { TranslationFn } from "../../../i18n";
import { OAuthProviderCard } from "./oauth-card";
import { ApiKeyProviderCard } from "./api-key-card";
import { CloudProviderCard } from "./cloud-card";

export interface ProviderCardProps {
  entry: ConnectorCatalogEntry;
  credential: CredentialSummary | null;
  expanded: boolean;
  onToggle: () => void;
  onOpenSettings?: () => void;
  t: TranslationFn;
}

/**
 * Dispatch based on the catalog auth descriptor. Five auth kinds live behind
 * three dedicated cards — cloud variants share a card because their onboarding
 * affordance is identical (deep link to Settings). A universal form generator
 * is intentionally avoided so each auth flow stays legible end-to-end.
 */
export function OnboardingProviderDispatch(props: ProviderCardProps) {
  const { entry } = props;
  switch (entry.auth.type) {
    case "oauth":
      return <OAuthProviderCard {...props} />;
    case "api_key":
      return <ApiKeyProviderCard {...props} />;
    case "aws":
    case "azure":
    case "gcp_adc":
      return <CloudProviderCard {...props} />;
  }
}
