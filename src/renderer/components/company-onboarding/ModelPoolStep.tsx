import { ActionButton } from "../ui";
import { ModelToggleList, StatusBadge } from "../execution/ModelManagementShared";
import { OnboardingStep } from "./OnboardingStep";
import { useOnboarding } from "./OnboardingContext";

interface ModelPoolStepProps {
  onBack: () => void;
  onContinue: () => void;
}

export function ModelPoolStep({ onBack, onContinue }: ModelPoolStepProps) {
  const {
    currentLocale,
    connectorModelPools,
    error,
    onToggleConnectorModel,
    selectedConnectorId,
    selectedConnectorEnabledModels,
    totalEnabledModels,
    t,
  } = useOnboarding();

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
          return (
            <div key={connector.id} className="rounded-lg border border-border bg-background/50 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {connector.id.startsWith("claude_compat") && connector.notes ? connector.notes : connector.label}
                    </span>
                    {connector.id === selectedConnectorId ? (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">
                        {currentLocale === "zh" ? "CEO 当前运行时" : "CEO runtime"}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {currentLocale === "zh"
                      ? `已启用 ${enabledCount} / ${models.length || 0} 个模型`
                      : `${enabledCount} / ${models.length || 0} models enabled`}
                  </div>
                </div>
                <StatusBadge status={connector.status} zh={currentLocale === "zh"} />
              </div>
              <ModelToggleList
                models={models}
                onToggle={(modelId) => void onToggleConnectorModel(connector.id, modelId)}
                canRemove={false}
                zh={currentLocale === "zh"}
              />
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
