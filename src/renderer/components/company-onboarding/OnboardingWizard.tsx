import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConnectorId,
  ExecutionMode,
  OnboardingBootstrapResult,
  ProfileSnapshot,
} from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { useT } from "../../i18n";
import { unwrap } from "../../lib/desktop";
import type { OnboardingStep, OnboardingStepName } from "./OnboardingHero";
import { WelcomeStep } from "./WelcomeStep";
import { OnboardingStepPanel, type OnboardingTabCompletion } from "./OnboardingStepPanel";
import { useConnectorCallbacks } from "./useConnectorCallbacks";
import { useConnectorModelSelection } from "./useConnectorModelSelection";
import {
  OnboardingConnectorsProvider,
  OnboardingWizardProvider,
  type OnboardingConnectorsContextValue,
  type OnboardingWizardContextValue,
} from "./OnboardingContext";
import type { CompanyStepValues } from "./CompanyStep";
import type { MissionStepValues } from "./MissionStep";

const EMPTY_COMPANY: CompanyStepValues = {
  companyName: "",
  companyDescription: "",
  workspacePath: "",
};

const EMPTY_MISSION: MissionStepValues = { goalTitle: "", goalDescription: "" };

export function CompanyOnboarding({
  connectors,
  onDone,
  canCancel = false,
  onCancel,
  currentLocale,
  onLocaleChange,
  isFirstLaunch = false,
}: {
  connectors: ProfileSnapshot["connectors"];
  onDone: (summary: OnboardingBootstrapResult) => Promise<void>;
  canCancel?: boolean;
  onCancel?: () => void;
  currentLocale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
  isFirstLaunch?: boolean;
}) {
  const t = useT();

  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [nodeStatus, setNodeStatus] = useState<{ installed: boolean; version: string | null } | null>(null);
  const [nodeChecking, setNodeChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchSummary, setLaunchSummary] = useState<OnboardingBootstrapResult | null>(null);

  // Finalized step-local snapshots. Written only on step "commit" (continue).
  const [companyValues, setCompanyValues] = useState<CompanyStepValues>(EMPTY_COMPANY);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("ai_ceo");
  const [missionValues, setMissionValues] = useState<MissionStepValues>(EMPTY_MISSION);

  const checkNode = useCallback(async () => {
    setNodeChecking(true);
    try {
      const result = unwrap(await window.agentCompany.checkNodeInstalled());
      setNodeStatus(result);
    } catch (error) {
      console.warn(
        `[onboarding/OnboardingWizard] checkNodeInstalled failed; assuming uninstalled: ${error instanceof Error ? error.message : String(error)}`,
      );
      setNodeStatus({ installed: false, version: null });
    } finally {
      setNodeChecking(false);
    }
  }, []);

  // Auto-check node when entering the nodecheck step
  useEffect(() => {
    if (step === "nodecheck" && nodeStatus === null) {
      void checkNode();
    }
  }, [step, nodeStatus, checkNode]);

  const { handleTestConnector, handleSaveConnector, handleInstallCommand } =
    useConnectorCallbacks(connectors);

  const {
    connectorModelPools,
    executionReadyConnectors,
    hasAtLeastOneReady,
    loadingModels,
    modelOptions,
    selectedConnector,
    selectedConnectorId,
    selectedModel,
    setSelectedConnectorId,
    setSelectedModel,
    selectedConnectorEnabledModels,
    totalEnabledModels,
    toggleConnectorModel,
    setAllConnectorModels,
  } = useConnectorModelSelection(connectors, currentLocale, t, setError);

  const pickDirectory = useCallback(async (): Promise<string | null> => {
    setError(null);
    const result = await window.agentCompany.pickDirectory();
    if (!result.ok) {
      setError(result.error.message);
      return null;
    }
    return result.data ?? null;
  }, []);

  const handleContinueFromCompany = useCallback(
    (values: CompanyStepValues) => {
      if (loading) return;
      if (!values.companyName.trim()) {
        setError(t("onboarding.enterCompanyName"));
        return;
      }
      setCompanyValues(values);
      setError(null);
      setStep("modelpool");
    },
    [loading, t],
  );

  const handleContinueFromExecutionMode = useCallback((mode: ExecutionMode) => {
    setExecutionMode(mode);
    setError(null);
    setStep("mission");
  }, []);

  const launchCompany = useCallback(
    async (values: MissionStepValues) => {
      if (loading) return;
      if (!values.goalTitle.trim()) {
        setError(t("onboarding.describeFirstGoal"));
        return;
      }
      setMissionValues(values);
      setLoading(true);
      setError(null);
      try {
        const result = unwrap(
          await window.agentCompany.bootstrapOnboarding({
            companyName: companyValues.companyName.trim(),
            companyDescription: companyValues.companyDescription.trim(),
            workspacePath: companyValues.workspacePath.trim(),
            autoApproveHires: executionMode === "ai_ceo",
            reviewDeliverables: executionMode === "ai_cofounder",
            executionMode,
            goalTitle: values.goalTitle.trim(),
            goalDescription: values.goalDescription.trim(),
            connectorId: selectedConnector?.id as ConnectorId | undefined,
            connectorModel: selectedModel.trim(),
          }),
        );
        setLaunchSummary(result);
        setStep("launch");
      } catch (submitError) {
        setError(
          submitError instanceof Error ? submitError.message : t("onboarding.unableToBootstrap"),
        );
      } finally {
        setLoading(false);
      }
    },
    [companyValues, executionMode, loading, selectedConnector?.id, selectedModel, t],
  );

  const finishLaunch = useCallback(async () => {
    if (!launchSummary) return;
    setLoading(true);
    setError(null);
    try {
      await onDone(launchSummary);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t("onboarding.unableToOpenControlCenter"),
      );
    } finally {
      setLoading(false);
    }
  }, [launchSummary, onDone, t]);

  const wizardValue = useMemo<OnboardingWizardContextValue>(
    () => ({
      currentLocale,
      t,
      error,
      loading,
      launchSummary,
      nodeStatus,
      nodeChecking,
      onCheckNode: () => void checkNode(),
      onInstallCommand: (commandKey) => void handleInstallCommand(commandKey),
    }),
    [currentLocale, t, error, loading, launchSummary, nodeStatus, nodeChecking, checkNode, handleInstallCommand],
  );

  const connectorsValue = useMemo<OnboardingConnectorsContextValue>(
    () => ({
      connectors,
      hasAtLeastOneReady,
      onTestConnector: (id) => void handleTestConnector(id),
      onSaveConnector: (id, env, model, notes) => void handleSaveConnector(id, env, model, notes),
      selectedConnectorId,
      setSelectedConnectorId,
      selectedModel,
      setSelectedModel,
      selectedConnector,
      executionReadyConnectors,
      connectorModelPools,
      modelOptions,
      loadingModels,
      totalEnabledModels,
      selectedConnectorEnabledModels,
      onToggleConnectorModel: (connectorId, modelId) =>
        void toggleConnectorModel(connectorId, modelId),
      onSetAllConnectorModels: (connectorId, enabled) =>
        void setAllConnectorModels(connectorId, enabled),
    }),
    [
      connectors,
      hasAtLeastOneReady,
      handleTestConnector,
      handleSaveConnector,
      selectedConnectorId,
      setSelectedConnectorId,
      selectedModel,
      setSelectedModel,
      selectedConnector,
      executionReadyConnectors,
      connectorModelPools,
      modelOptions,
      loadingModels,
      totalEnabledModels,
      selectedConnectorEnabledModels,
      toggleConnectorModel,
      setAllConnectorModels,
    ],
  );

  const isWelcome = step === "welcome";
  const heroStep: OnboardingStep = step as OnboardingStep;

  // Completion flags drive the tab ticks. Each rule mirrors the
  // validation that the in-step "Continue" button enforces, so a user
  // who navigates tabs freely cannot land on "mission" with a green
  // "company" tick unless company data is actually valid. `launch`
  // does not get a tab (it has no independent field; it just consumes
  // the others).
  const navigateToStep = useCallback((target: OnboardingStepName) => {
    setError(null);
    setStep(target);
  }, []);

  const tabCompletion: OnboardingTabCompletion = useMemo(
    () => ({
      nodecheck: Boolean(nodeStatus?.installed),
      providers: hasAtLeastOneReady,
      company: companyValues.companyName.trim().length > 0 && selectedConnectorId !== "",
      modelpool: totalEnabledModels > 0,
      executionmode: true, // has a default ("ai_ceo")
      mission: missionValues.goalTitle.trim().length > 0,
    }),
    [
      nodeStatus?.installed,
      hasAtLeastOneReady,
      companyValues.companyName,
      selectedConnectorId,
      totalEnabledModels,
      missionValues.goalTitle,
    ],
  );

  return (
    <div
      className={`relative h-[100dvh] overflow-hidden bg-background ${
        isWelcome ? "flex items-stretch" : "grid md:grid-cols-[minmax(0,1fr)_540px]"
      }`}
    >
      <div className="sidebar-drag absolute inset-x-0 top-0 z-10 h-[38px]" />

      {isWelcome ? (
        <WelcomeStep
          onContinue={() => setStep("nodecheck")}
          currentLocale={currentLocale}
          onLocaleChange={onLocaleChange}
          t={t}
        />
      ) : (
        <OnboardingWizardProvider value={wizardValue}>
          <OnboardingConnectorsProvider value={connectorsValue}>
            <OnboardingStepPanel
              step={heroStep}
              canCancel={canCancel}
              onCancel={onCancel}
              isFirstLaunch={isFirstLaunch}
              onBack={setStep}
              onNavigateToStep={navigateToStep}
              tabCompletion={tabCompletion}
              onContinueFromNodeCheck={() => {
                setError(null);
                setStep("providers");
              }}
              onContinueFromProviders={() => {
                setError(null);
                setStep("company");
              }}
              onContinueFromCompany={handleContinueFromCompany}
              onContinueFromModelPool={() => {
                setError(null);
                setStep("executionmode");
              }}
              onContinueFromExecutionMode={handleContinueFromExecutionMode}
              onLaunchCompany={(values) => void launchCompany(values)}
              onFinishLaunch={() => void finishLaunch()}
              onPickDirectory={pickDirectory}
              companyValues={companyValues}
              missionValues={missionValues}
              executionMode={executionMode}
            />
          </OnboardingConnectorsProvider>
        </OnboardingWizardProvider>
      )}
    </div>
  );
}
