import { AnimatePresence } from "framer-motion";
import type { ExecutionMode } from "@shared/types";
import { OnboardingHero, type OnboardingStep } from "./OnboardingHero";
import { NodeCheckStep } from "./NodeCheckStep";
import { ProvidersStep } from "./ProvidersStep";
import { CompanyStep, type CompanyStepValues } from "./CompanyStep";
import { ModelPoolStep } from "./ModelPoolStep";
import { ExecutionModeStep } from "./ExecutionModeStep";
import { MissionStep, type MissionStepValues } from "./MissionStep";
import { LaunchStep } from "./LaunchStep";
import { useOnboardingWizard } from "./OnboardingContext";

interface OnboardingStepPanelProps {
  step: OnboardingStep;
  canCancel: boolean;
  onCancel?: () => void;
  isFirstLaunch: boolean;
  onBack: (step: OnboardingStep) => void;
  onContinueFromNodeCheck: () => void;
  onContinueFromProviders: () => void;
  onContinueFromCompany: (values: CompanyStepValues) => void;
  onContinueFromModelPool: () => void;
  onContinueFromExecutionMode: (mode: ExecutionMode) => void;
  onLaunchCompany: (values: MissionStepValues) => void;
  onFinishLaunch: () => void;
  onPickDirectory: () => Promise<string | null>;
  companyValues: CompanyStepValues;
  missionValues: MissionStepValues;
  executionMode: ExecutionMode;
}

export function OnboardingStepPanel({
  step,
  canCancel,
  onCancel,
  isFirstLaunch,
  onBack,
  onContinueFromNodeCheck,
  onContinueFromProviders,
  onContinueFromCompany,
  onContinueFromModelPool,
  onContinueFromExecutionMode,
  onLaunchCompany,
  onFinishLaunch,
  onPickDirectory,
  companyValues,
  missionValues,
  executionMode,
}: OnboardingStepPanelProps) {
  const { currentLocale, t, launchSummary } = useOnboardingWizard();

  return (
    <>
      <OnboardingHero step={step} currentLocale={currentLocale} t={t} />

      <div className="min-h-0 overflow-y-auto border-l border-border bg-background">
        <div className="relative flex min-h-full items-center px-6 py-10 md:px-10">
          {canCancel && onCancel && !isFirstLaunch ? (
            <button
              type="button"
              onClick={onCancel}
              className="absolute right-6 top-6 text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
            >
              {t("onboarding.cancel")}
            </button>
          ) : null}

          <AnimatePresence mode="wait">
            {step === "nodecheck" ? (
              <NodeCheckStep
                onContinue={onContinueFromNodeCheck}
                onBack={() => onBack("welcome")}
              />
            ) : null}

            {step === "providers" ? (
              <ProvidersStep
                onContinue={onContinueFromProviders}
                onBack={() => onBack("nodecheck")}
              />
            ) : null}

            {step === "company" ? (
              <CompanyStep
                initialValues={companyValues}
                onPickDirectory={onPickDirectory}
                onContinue={onContinueFromCompany}
                onBack={() => onBack("providers")}
              />
            ) : null}

            {step === "modelpool" ? (
              <ModelPoolStep
                onBack={() => onBack("company")}
                onContinue={onContinueFromModelPool}
              />
            ) : null}

            {step === "executionmode" ? (
              <ExecutionModeStep
                initialValue={executionMode}
                onContinue={onContinueFromExecutionMode}
                onBack={() => onBack("modelpool")}
              />
            ) : null}

            {step === "mission" ? (
              <MissionStep
                initialValues={missionValues}
                onLaunch={onLaunchCompany}
                onBack={() => onBack("executionmode")}
              />
            ) : null}

            {step === "launch" && launchSummary ? (
              <LaunchStep onFinish={onFinishLaunch} />
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
