import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CaretDown, CaretRight } from "../ui/icons";
import { ActionButton } from "../ui";
import type { CredentialSummary } from "@shared/contracts/schemas-credentials";
import {
  CONNECTOR_CATALOG,
  listFeaturedOnboardingConnectors,
} from "@shared/connector-catalog";
import { OnboardingStep } from "./OnboardingStep";
import { useOnboardingWizard } from "./OnboardingContext";
import { OnboardingProviderDispatch } from "./provider-cards/ProviderCard";

interface ProvidersStepProps {
  onContinue: () => void;
  onBack: () => void;
}

const FEATURED = listFeaturedOnboardingConnectors();
const FEATURED_IDS = new Set(FEATURED.map((entry) => entry.id));
const ADVANCED = CONNECTOR_CATALOG.filter((entry) => !FEATURED_IDS.has(entry.id));

export function ProvidersStep({ onContinue, onBack }: ProvidersStepProps) {
  const { t, error } = useOnboardingWizard();
  const [credentialsMap, setCredentialsMap] = useState<Map<string, CredentialSummary>>(
    new Map(),
  );
  const [expandedId, setExpandedId] = useState<string | null>(FEATURED[0]?.id ?? null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    const desktop = window.agentCompany;
    if (!desktop) return;
    let cancelled = false;

    const refresh = async () => {
      const result = await desktop.listCredentials();
      if (cancelled || !result.ok) return;
      setCredentialsMap(new Map(result.data.map((row) => [row.connectorId, row])));
    };

    void refresh();
    const unsubscribe = desktop.subscribe((event) => {
      if (event.type !== "credentials-changed") return;
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const readyCount = useMemo(
    () => Array.from(credentialsMap.values()).filter((c) => c.status === "active").length,
    [credentialsMap],
  );
  const canContinue = readyCount > 0;

  const toggle = (id: string) =>
    setExpandedId((current) => (current === id ? null : id));

  return (
    <OnboardingStep
      step="providers"
      eyebrow={t("onboarding.stepLabelProviders")}
      title={t("onboarding.providers.title")}
      subtitle={t("onboarding.providers.subtitle")}
    >
      <section aria-label={t("onboarding.providers.featuredHeading")} className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {t("onboarding.providers.featuredHeading")}
          </h3>
          <span className="text-[11px] text-muted-foreground/70">
            {readyCount > 0
              ? `${readyCount} ${t("onboarding.providers.ready")}`
              : t("onboarding.providers.noneConfigured")}
          </span>
        </div>
        {FEATURED.map((entry) => (
          <OnboardingProviderDispatch
            key={entry.id}
            entry={entry}
            credential={credentialsMap.get(entry.id) ?? null}
            expanded={expandedId === entry.id}
            onToggle={() => toggle(entry.id)}
            t={t}
          />
        ))}
      </section>

      <section aria-label={t("onboarding.providers.advancedHeading")} className="mt-6">
        <button
          type="button"
          onClick={() => setAdvancedOpen((value) => !value)}
          className="flex w-full items-center justify-between rounded-md border border-border bg-card px-4 py-2.5 text-left transition hover:bg-muted/40"
        >
          <span className="flex items-center gap-2">
            {advancedOpen ? (
              <CaretDown size={13} className="text-muted-foreground" />
            ) : (
              <CaretRight size={13} className="text-muted-foreground" />
            )}
            <span className="text-[12px] font-semibold text-foreground">
              {t("onboarding.providers.advancedHeading")}
            </span>
          </span>
          <span className="text-[11px] text-muted-foreground/70">
            {`${ADVANCED.length} ${t("onboarding.providers.providersLabel")}`}
          </span>
        </button>
        {advancedOpen ? (
          <div className="mt-3 space-y-3">
            {ADVANCED.map((entry) => (
              <OnboardingProviderDispatch
                key={entry.id}
                entry={entry}
                credential={credentialsMap.get(entry.id) ?? null}
                expanded={expandedId === entry.id}
                onToggle={() => toggle(entry.id)}
                t={t}
              />
            ))}
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="mt-5 rounded-lg border border-[color:var(--destructive)] bg-destructive-muted px-4 py-3 text-[13px] text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          {t("onboarding.back")}
        </button>
        <div className="flex items-center gap-4">
          {!canContinue ? (
            <span className="text-[12px] text-muted-foreground">
              {t("onboarding.providers.atLeastOne")}
            </span>
          ) : null}
          <ActionButton
            label={t("onboarding.continue")}
            onClick={onContinue}
            icon={ArrowRight}
            tone="accent"
            disabled={!canContinue}
          />
        </div>
      </div>
    </OnboardingStep>
  );
}
