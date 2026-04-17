import { ArrowSquareOut } from "../../ui/icons";
import type { ConnectorCatalogEntry } from "@shared/connector-catalog";
import type { CredentialSummary } from "@shared/contracts/schemas-credentials";
import type { TranslationFn } from "../../../i18n";
import {
  InlineFeedback,
  OnboardingProviderCard,
  OnboardingStatusBadge,
  type OnboardingCardStatus,
} from "./shared";

interface CloudCardProps {
  entry: ConnectorCatalogEntry;
  credential: CredentialSummary | null;
  expanded: boolean;
  onToggle: () => void;
  onOpenSettings?: () => void;
  t: TranslationFn;
}

/**
 * Cloud connectors (AWS / Azure / GCP ADC) need multi-field forms. During
 * onboarding we show a short primer and route the user to Settings where the
 * dedicated forms live. Status reflects an existing credential if one was
 * already set up outside onboarding.
 */
export function CloudProviderCard({
  entry,
  credential,
  expanded,
  onToggle,
  onOpenSettings,
  t,
}: CloudCardProps) {
  const status: OnboardingCardStatus = credential?.status ?? "not_configured";

  return (
    <OnboardingProviderCard
      label={entry.label}
      description={entry.description}
      badge={<OnboardingStatusBadge status={status} t={t} />}
      expanded={expanded}
      onToggle={onToggle}
    >
      {entry.notes ? (
        <div className="text-[12px] leading-relaxed text-muted-foreground">{entry.notes}</div>
      ) : null}
      <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
        {t("onboarding.providers.cloudPrimer")}
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        disabled={!onOpenSettings}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted disabled:opacity-40"
      >
        <ArrowSquareOut size={14} />
        {t("onboarding.providers.configureInSettings")}
      </button>
      {credential?.displayHint ? (
        <div className="text-[11px] text-muted-foreground">{credential.displayHint}</div>
      ) : null}
      <InlineFeedback message={null} />
    </OnboardingProviderCard>
  );
}
