import { useCallback, useEffect, useState } from "react";
import type { ConnectorId, ExecutionMode, OnboardingBootstrapResult, ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { useT } from "../../i18n";
import { unwrap } from "../../lib/desktop";
import type { OnboardingStep } from "./OnboardingHero";
import { WelcomeStep } from "./WelcomeStep";
import { OnboardingStepPanel } from "./OnboardingStepPanel";
import { useConnectorCallbacks } from "./useConnectorCallbacks";
import { useConnectorModelSelection } from "./useConnectorModelSelection";

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

  const checkNode = useCallback(async () => {
    setNodeChecking(true);
    try {
      const result = unwrap(await window.agentCompany.checkNodeInstalled());
      setNodeStatus(result);
    } catch {
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

  const { handleTestConnector, handleSaveConnector, handleLoginConnector, handleInstallCommand } =
    useConnectorCallbacks(connectors);
  const [companyName, setCompanyName] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("ai_ceo");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchSummary, setLaunchSummary] = useState<OnboardingBootstrapResult | null>(null);
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
  } = useConnectorModelSelection(connectors, currentLocale, t, setError);

  const pickDirectory = useCallback(async () => {
    setError(null);
    const result = await window.agentCompany.pickDirectory();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.data) {
      setWorkspacePath(result.data);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    const result = unwrap(await window.agentCompany.bootstrapOnboarding({
      companyName: companyName.trim(),
      companyDescription: companyDescription.trim(),
      workspacePath: workspacePath.trim(),
      autoApproveHires: executionMode === "ai_ceo",
      reviewDeliverables: executionMode === "ai_cofounder",
      executionMode,
      goalTitle: goalTitle.trim(),
      goalDescription: goalDescription.trim(),
      connectorId: selectedConnector?.id as ConnectorId | undefined,
      connectorModel: selectedModel.trim(),
    }));
    setLaunchSummary(result);
    setStep("launch");
  }, [
    executionMode,
    companyDescription,
    companyName,
    goalDescription,
    goalTitle,
    selectedConnector?.id,
    selectedModel,
    workspacePath,
  ]);

  const continueToMission = useCallback(() => {
    if (loading) return;
    if (!companyName.trim()) {
      setError(t("onboarding.enterCompanyName"));
      return;
    }
    setError(null);
    setStep("modelpool");
  }, [companyName, loading, t]);

  const launchCompany = useCallback(async () => {
    if (loading) return;
    if (!goalTitle.trim()) {
      setError(t("onboarding.describeFirstGoal"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await bootstrap();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("onboarding.unableToBootstrap"));
    } finally {
      setLoading(false);
    }
  }, [bootstrap, goalTitle, loading, t]);

  const finishLaunch = useCallback(async () => {
    if (!launchSummary) return;
    setLoading(true);
    setError(null);
    try {
      await onDone(launchSummary);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("onboarding.unableToOpenControlCenter"));
    } finally {
      setLoading(false);
    }
  }, [launchSummary, onDone, t]);

  const isWelcome = step === "welcome";
  const heroStep: OnboardingStep = step as OnboardingStep;

  return (
    <div
      className={`relative h-[100dvh] overflow-hidden bg-background ${
        isWelcome
          ? "flex items-stretch"
          : "grid md:grid-cols-[minmax(0,1fr)_540px]"
      }`}
    >
      {/* Drag region for frameless title bar */}
      <div className="sidebar-drag absolute inset-x-0 top-0 z-10 h-[38px]" />

      {isWelcome ? (
        <WelcomeStep
          onContinue={() => setStep("nodecheck")}
          currentLocale={currentLocale}
          onLocaleChange={onLocaleChange}
          t={t}
        />
      ) : (
        <>
          <OnboardingStepPanel
            step={heroStep}
            currentLocale={currentLocale}
            t={t}
            canCancel={canCancel}
            onCancel={onCancel}
            isFirstLaunch={isFirstLaunch}
            nodeStatus={nodeStatus}
            nodeChecking={nodeChecking}
            onCheckNode={() => void checkNode()}
            onInstallCommand={(commandKey) => void handleInstallCommand(commandKey)}
            connectors={connectors}
            hasAtLeastOneReady={hasAtLeastOneReady}
            onTestConnector={(id) => void handleTestConnector(id)}
            onSaveConnector={(id, env, model, notes) => void handleSaveConnector(id, env, model, notes)}
            onLoginConnector={(id) => void handleLoginConnector(id)}
            error={error}
            companyName={companyName}
            setCompanyName={setCompanyName}
            companyDescription={companyDescription}
            setCompanyDescription={setCompanyDescription}
            selectedConnectorId={selectedConnectorId}
            setSelectedConnectorId={setSelectedConnectorId}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            executionReadyConnectors={executionReadyConnectors}
            connectorModelPools={connectorModelPools}
            modelOptions={modelOptions}
            loadingModels={loadingModels}
            totalEnabledModels={totalEnabledModels}
            selectedConnectorEnabledModels={selectedConnectorEnabledModels}
            onToggleConnectorModel={(connectorId, modelId) => void toggleConnectorModel(connectorId, modelId)}
            workspacePath={workspacePath}
            setWorkspacePath={setWorkspacePath}
            onPickDirectory={() => void pickDirectory()}
            executionMode={executionMode}
            setExecutionMode={setExecutionMode}
            goalTitle={goalTitle}
            setGoalTitle={setGoalTitle}
            goalDescription={goalDescription}
            setGoalDescription={setGoalDescription}
            loading={loading}
            launchSummary={launchSummary}
            selectedConnector={selectedConnector}
            onBack={setStep}
            onContinueFromNodeCheck={() => { setError(null); setStep("providers"); }}
            onContinueFromProviders={() => { setError(null); setStep("company"); }}
            onContinueFromCompany={() => void continueToMission()}
            onContinueFromModelPool={() => { setError(null); setStep("executionmode"); }}
            onContinueFromExecutionMode={() => { setError(null); setStep("mission"); }}
            onLaunchCompany={() => void launchCompany()}
            onFinishLaunch={() => void finishLaunch()}
          />
        </>
      )}
    </div>
  );
}
