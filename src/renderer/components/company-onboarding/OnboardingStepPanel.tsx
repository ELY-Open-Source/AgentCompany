import { AnimatePresence } from "framer-motion";
import type { ExecutionMode } from "@shared/types";
import {
  Buildings,
  CheckCircle,
  HardDrive,
  Plugs,
  SlidersHorizontal,
  Target,
} from "../ui/icons";
import { OnboardingHero, STEP_ORDER, type OnboardingStep, type OnboardingStepName } from "./OnboardingHero";
import { NodeCheckStep } from "./NodeCheckStep";
import { ProvidersStep } from "./ProvidersStep";
import { CompanyStep, type CompanyStepValues } from "./CompanyStep";
import { ModelPoolStep } from "./ModelPoolStep";
import { ExecutionModeStep } from "./ExecutionModeStep";
import { MissionStep, type MissionStepValues } from "./MissionStep";
import { LaunchStep } from "./LaunchStep";
import { useOnboardingWizard } from "./OnboardingContext";

/**
 * Completion flag per tab. Computed in OnboardingWizard from the
 * wizard's finalized values + connector slice, threaded down here so
 * the tab bar can show a tick next to finished sections and the user
 * can tell at a glance what is still blocking launch. `launch` is
 * implied complete once all six earlier tabs are true; it has no
 * independent field.
 */
export interface OnboardingTabCompletion {
  nodecheck: boolean;
  providers: boolean;
  company: boolean;
  modelpool: boolean;
  executionmode: boolean;
  mission: boolean;
}

interface OnboardingStepPanelProps {
  step: OnboardingStep;
  canCancel: boolean;
  onCancel?: () => void;
  isFirstLaunch: boolean;
  onBack: (step: OnboardingStep) => void;
  /**
   * Jump directly to an arbitrary setup tab. Called by the tab bar;
   * unlike `onBack` it is symmetric (can move forward or backward).
   */
  onNavigateToStep: (step: OnboardingStepName) => void;
  tabCompletion: OnboardingTabCompletion;
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

type SetupTabId = Exclude<OnboardingStepName, "launch">;

const SETUP_TABS: ReadonlyArray<{
  id: SetupTabId;
  icon: typeof HardDrive;
  labelKey: string;
}> = [
  { id: "nodecheck", icon: HardDrive, labelKey: "onboarding.stepLabelNodeCheck" },
  { id: "providers", icon: Plugs, labelKey: "onboarding.stepLabelProviders" },
  { id: "company", icon: Buildings, labelKey: "onboarding.stepLabelCompany" },
  { id: "modelpool", icon: SlidersHorizontal, labelKey: "onboarding.stepLabelModelPool" },
  { id: "executionmode", icon: CheckCircle, labelKey: "onboarding.stepLabelMode" },
  { id: "mission", icon: Target, labelKey: "onboarding.stepLabelMission" },
];

function isSetupTabId(step: OnboardingStep): step is SetupTabId {
  return (STEP_ORDER as readonly OnboardingStep[]).includes(step) && step !== "launch";
}

export function OnboardingStepPanel({
  step,
  canCancel,
  onCancel,
  isFirstLaunch,
  onBack,
  onNavigateToStep,
  tabCompletion,
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
  const showTabs = isSetupTabId(step);

  return (
    <>
      <OnboardingHero step={step} currentLocale={currentLocale} t={t} />

      <div className="min-h-0 overflow-y-auto border-l border-border bg-background">
        <div className="relative flex min-h-full flex-col px-6 py-10 md:px-10">
          {canCancel && onCancel && !isFirstLaunch ? (
            <button
              type="button"
              onClick={onCancel}
              className="absolute right-6 top-6 text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
            >
              {t("onboarding.cancel")}
            </button>
          ) : null}

          {showTabs ? (
            <nav
              role="tablist"
              aria-label={t("onboarding.stepsAria")}
              className="mb-6 flex flex-wrap gap-1 border-b border-border"
            >
              {SETUP_TABS.map((tab) => {
                const active = step === tab.id;
                const done = tabCompletion[tab.id];
                const Icon = done ? CheckCircle : tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onNavigateToStep(tab.id)}
                    className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      active
                        ? "text-foreground"
                        : done
                          ? "text-success hover:text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon
                      size={13}
                      weight={done ? "fill" : "regular"}
                      className={done && !active ? "text-success" : undefined}
                    />
                    <span>{t(tab.labelKey)}</span>
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-2 bottom-[-1px] h-[2px] bg-primary"
                      />
                    ) : null}
                  </button>
                );
              })}
            </nav>
          ) : null}

          <div className="flex flex-1 items-center">
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
      </div>
    </>
  );
}
