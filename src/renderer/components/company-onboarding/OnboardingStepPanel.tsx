import type { AppLocale } from "@shared/locale";
import type { ConnectorId, OnboardingBootstrapResult, ProfileSnapshot } from "@shared/types";
import type { ConnectorModelEntry } from "@shared/connector-models";
import type { TerminalCommandKey } from "@shared/contracts";
import { AnimatePresence } from "framer-motion";
import type { TranslationFn } from "../../i18n";
import { OnboardingHero, type OnboardingStep } from "./OnboardingHero";
import { NodeCheckStep } from "./NodeCheckStep";
import { ProvidersStep } from "./ProvidersStep";
import { CompanyStep } from "./CompanyStep";
import { ModelPoolStep } from "./ModelPoolStep";
import { ExecutionModeStep } from "./ExecutionModeStep";
import { MissionStep } from "./MissionStep";
import { LaunchStep } from "./LaunchStep";

interface OnboardingStepPanelProps {
  step: OnboardingStep;
  currentLocale: AppLocale;
  t: TranslationFn;
  canCancel: boolean;
  onCancel?: () => void;
  isFirstLaunch: boolean;
  nodeStatus: { installed: boolean; version: string | null } | null;
  nodeChecking: boolean;
  onCheckNode: () => void;
  onInstallCommand: (commandKey: TerminalCommandKey) => void;
  connectors: ProfileSnapshot["connectors"];
  hasAtLeastOneReady: boolean;
  onTestConnector: (connectorId: string) => void;
  onSaveConnector: (connectorId: string, envBindingText: string, model: string | null, notes?: string) => void;
  onLoginConnector: (connectorId: string) => void;
  error: string | null;
  companyName: string;
  setCompanyName: (value: string) => void;
  companyDescription: string;
  setCompanyDescription: (value: string) => void;
  selectedConnectorId: ConnectorId | "";
  setSelectedConnectorId: (value: ConnectorId | "") => void;
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  executionReadyConnectors: ProfileSnapshot["connectors"];
  connectorModelPools: Array<{
    connector: ProfileSnapshot["connectors"][number];
    models: ConnectorModelEntry[];
  }>;
  modelOptions: Array<{ id: string; label: string }>;
  loadingModels: boolean;
  totalEnabledModels: number;
  selectedConnectorEnabledModels: number;
  onToggleConnectorModel: (connectorId: ConnectorId, modelId: string) => void;
  workspacePath: string;
  setWorkspacePath: (value: string) => void;
  onPickDirectory: () => void;
  executionMode: "ai_ceo" | "ai_cofounder";
  setExecutionMode: (value: "ai_ceo" | "ai_cofounder") => void;
  goalTitle: string;
  setGoalTitle: (value: string) => void;
  goalDescription: string;
  setGoalDescription: (value: string) => void;
  loading: boolean;
  launchSummary: OnboardingBootstrapResult | null;
  selectedConnector: ProfileSnapshot["connectors"][number] | null;
  onBack: (step: OnboardingStep) => void;
  onContinueFromNodeCheck: () => void;
  onContinueFromProviders: () => void;
  onContinueFromCompany: () => void;
  onContinueFromModelPool: () => void;
  onContinueFromExecutionMode: () => void;
  onLaunchCompany: () => void;
  onFinishLaunch: () => void;
}

export function OnboardingStepPanel({
  step,
  currentLocale,
  t,
  canCancel,
  onCancel,
  isFirstLaunch,
  nodeStatus,
  nodeChecking,
  onCheckNode,
  onInstallCommand,
  connectors,
  hasAtLeastOneReady,
  onTestConnector,
  onSaveConnector,
  onLoginConnector,
  error,
  companyName,
  setCompanyName,
  companyDescription,
  setCompanyDescription,
  selectedConnectorId,
  setSelectedConnectorId,
  selectedModel,
  setSelectedModel,
  executionReadyConnectors,
  connectorModelPools,
  modelOptions,
  loadingModels,
  totalEnabledModels,
  selectedConnectorEnabledModels,
  onToggleConnectorModel,
  workspacePath,
  setWorkspacePath,
  onPickDirectory,
  executionMode,
  setExecutionMode,
  goalTitle,
  setGoalTitle,
  goalDescription,
  setGoalDescription,
  loading,
  launchSummary,
  selectedConnector,
  onBack,
  onContinueFromNodeCheck,
  onContinueFromProviders,
  onContinueFromCompany,
  onContinueFromModelPool,
  onContinueFromExecutionMode,
  onLaunchCompany,
  onFinishLaunch,
}: OnboardingStepPanelProps) {
  return (
    <>
      <OnboardingHero
        step={step}
        currentLocale={currentLocale}
        t={t}
      />

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
                nodeStatus={nodeStatus}
                checking={nodeChecking}
                onCheck={onCheckNode}
                onInstall={(commandKey) => onInstallCommand(commandKey)}
                onContinue={onContinueFromNodeCheck}
                onBack={() => onBack("welcome")}
                t={t}
              />
            ) : null}

            {step === "providers" ? (
              <ProvidersStep
                connectors={connectors}
                onTestConnector={onTestConnector}
                onSaveConnector={onSaveConnector}
                onLoginConnector={onLoginConnector}
                onInstallCommand={onInstallCommand}
                hasAtLeastOneReady={hasAtLeastOneReady}
                onContinue={onContinueFromProviders}
                onBack={() => onBack("nodecheck")}
                error={error}
                t={t}
              />
            ) : null}

            {step === "company" ? (
              <CompanyStep
                companyName={companyName}
                setCompanyName={setCompanyName}
                companyDescription={companyDescription}
                setCompanyDescription={setCompanyDescription}
                selectedConnectorId={selectedConnectorId}
                setSelectedConnectorId={setSelectedConnectorId}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                executionReadyConnectors={executionReadyConnectors}
                modelOptions={modelOptions}
                loadingModels={loadingModels}
                workspacePath={workspacePath}
                setWorkspacePath={setWorkspacePath}
                onPickDirectory={onPickDirectory}
                onContinue={onContinueFromCompany}
                onBack={() => onBack("providers")}
                error={error}
                currentLocale={currentLocale}
                t={t}
              />
            ) : null}

            {step === "modelpool" ? (
              <ModelPoolStep
                currentLocale={currentLocale}
                connectorModelPools={connectorModelPools}
                error={error}
                onBack={() => onBack("company")}
                onContinue={onContinueFromModelPool}
                onToggleConnectorModel={onToggleConnectorModel}
                selectedConnectorId={selectedConnectorId}
                selectedConnectorEnabledModels={selectedConnectorEnabledModels}
                totalEnabledModels={totalEnabledModels}
                t={t}
              />
            ) : null}

            {step === "executionmode" ? (
              <ExecutionModeStep
                executionMode={executionMode}
                setExecutionMode={setExecutionMode}
                onContinue={onContinueFromExecutionMode}
                onBack={() => onBack("modelpool")}
                t={t}
              />
            ) : null}

            {step === "mission" ? (
              <MissionStep
                goalTitle={goalTitle}
                setGoalTitle={setGoalTitle}
                goalDescription={goalDescription}
                setGoalDescription={setGoalDescription}
                onLaunch={onLaunchCompany}
                onBack={() => onBack("executionmode")}
                loading={loading}
                error={error}
                t={t}
              />
            ) : null}

            {step === "launch" && launchSummary ? (
              <LaunchStep
                launchSummary={launchSummary}
                selectedConnector={selectedConnector}
                onFinish={onFinishLaunch}
                loading={loading}
                error={error}
                t={t}
              />
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
