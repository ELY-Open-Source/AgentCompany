import { ActionButton } from "../ui";
import { ModelToggleList, StatusBadge } from "../execution/ModelManagementShared";
import { OnboardingStep } from "./OnboardingStep";
import {
  useOnboardingConnectors,
  useOnboardingWizard,
} from "./OnboardingContext";

interface ModelPoolStepProps {
  onBack: () => void;
  onContinue: () => void;
}

export function ModelPoolStep({ onBack, onContinue }: ModelPoolStepProps) {
  const { error, t } = useOnboardingWizard();
  const {
    connectorModelPools,
    onToggleConnectorModel,
    onSetAllConnectorModels,
    selectedConnectorId,
    selectedConnectorEnabledModels,
    totalEnabledModels,
  } = useOnboardingConnectors();

  const selectedConnectorIsRunnable = selectedConnectorEnabledModels > 0;
  const hasAnyEnabledModels = totalEnabledModels > 0;
  const canContinue = hasAnyEnabledModels && selectedConnectorIsRunnable;
  const readinessHint = !hasAnyEnabledModels
    ? t("onboarding.modelPoolGlobalRequirement")
    : !selectedConnectorIsRunnable
      ? t("onboarding.modelPoolSelectedConnectorRequirement")
      : t("onboarding.modelPoolContinueHint");

  return (
    <OnboardingStep
      step="modelpool"
      eyebrow={t("onboarding.stepLabelModelPool")}
      title={t("onboarding.modelPoolStepTitle")}
      subtitle={t("onboarding.modelPoolStepSubtitle")}
    >
      <div className="mb-4 rounded-lg border border-border bg-background/70 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
        {t("onboarding.modelPoolStepDescription")}
      </div>

      <div className="space-y-3">
        {connectorModelPools.map(({ connector, models }) => {
          const enabledCount = models.filter((model) => model.enabled).length;
          const allEnabled = models.length > 0 && enabledCount === models.length;
          // One action, state-aware: when everything is on the next useful
          // move is "disable all"; otherwise the user almost always wants
          // "enable all". Two buttons would compete for the user's decision
          // for no real benefit.
          const bulkAction = allEnabled
            ? { label: t("models.disableAll"), target: false }
            : { label: t("models.enableAll"), target: true };
          return (
            <div key={connector.id} className="rounded-lg border border-border bg-background/50 p-4">
              {/* Row 1 — identity + health. Title has room to breathe. */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {connector.id.startsWith("claude_compat") && connector.notes ? connector.notes : connector.label}
                  </span>
                  {connector.id === selectedConnectorId ? (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">
                      {t("models.ceoRuntime")}
                    </span>
                  ) : null}
                </div>
                <StatusBadge status={connector.status} />
              </div>
              {/* Row 2 — stats + bulk action. Only rendered when there is */}
              {/* more than one model (single-model providers have nothing */}
              {/* meaningful to bulk-toggle). */}
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span>
                  {t("models.poolSummary").replace("{enabled}", String(enabledCount)).replace("{total}", String(models.length || 0))}
                </span>
                {models.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => onSetAllConnectorModels(connector.id, bulkAction.target)}
                    className="whitespace-nowrap rounded-md border border-border bg-background/60 px-2 py-1 text-[11px] text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
                  >
                    {bulkAction.label}
                  </button>
                ) : null}
              </div>
              <div className="mt-3">
                <ModelToggleList
                  models={models}
                  onToggle={(modelId) => void onToggleConnectorModel(connector.id, modelId)}
                  canRemove={false}
                />
              </div>
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="mt-5 rounded-lg border border-[color:var(--destructive)] bg-destructive-muted px-4 py-3 text-[13px] text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-5 text-[12px] text-muted-foreground">{readinessHint}</div>

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          {t("onboarding.back")}
        </button>
        <ActionButton
          label={t("onboarding.continue")}
          onClick={onContinue}
          tone="accent"
          disabled={!canContinue}
        />
      </div>
    </OnboardingStep>
  );
}
