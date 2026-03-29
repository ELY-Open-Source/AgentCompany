import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { isConnectorExecutionReady } from "@shared/connector-policy";
import type { ConnectorId, OnboardingBootstrapResult, ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { useT } from "../../i18n";
import { unwrap } from "../../lib/desktop";
import { OnboardingHero, type OnboardingStep } from "./OnboardingHero";
import { WelcomeStep } from "./WelcomeStep";
import { NodeCheckStep } from "./NodeCheckStep";
import { ProvidersStep } from "./ProvidersStep";
import { CompanyStep } from "./CompanyStep";
import { MissionStep } from "./MissionStep";
import { LaunchStep } from "./LaunchStep";

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

  /* ------------------------------------------------------------------ */
  /*  Step navigation                                                    */
  /* ------------------------------------------------------------------ */

  const [step, setStep] = useState<OnboardingStep>("welcome");

  /* ------------------------------------------------------------------ */
  /*  Node.js check state                                                */
  /* ------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------ */
  /*  Provider / connector state                                         */
  /* ------------------------------------------------------------------ */

  const executionReadyConnectors = useMemo(
    () => connectors.filter((c) => isConnectorExecutionReady(c)),
    [connectors],
  );
  const hasAtLeastOneReady = executionReadyConnectors.length > 0;

  const [selectedConnectorId, setSelectedConnectorId] = useState<string>(
    executionReadyConnectors[0]?.id ?? "",
  );

  // Keep selected connector in sync with readiness changes
  useEffect(() => {
    if (!selectedConnectorId && executionReadyConnectors[0]) {
      setSelectedConnectorId(executionReadyConnectors[0].id);
      return;
    }
    if (selectedConnectorId && !executionReadyConnectors.some((c) => c.id === selectedConnectorId)) {
      setSelectedConnectorId(executionReadyConnectors[0]?.id ?? "");
    }
  }, [executionReadyConnectors, selectedConnectorId]);

  const selectedConnector =
    executionReadyConnectors.find((c) => c.id === selectedConnectorId) ??
    executionReadyConnectors[0] ?? null;

  /* ------------------------------------------------------------------ */
  /*  CEO model selection                                                */
  /* ------------------------------------------------------------------ */

  const [selectedModel, setSelectedModel] = useState("");
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Load models when the selected connector changes
  useEffect(() => {
    if (!selectedConnectorId) { setModelOptions([]); return; }

    // For claude_compatible, parse user-configured models (comma-separated in connector.model)
    if (selectedConnectorId.startsWith("claude_compat")) {
      const compat = connectors.find((c) => c.id === selectedConnectorId);
      const raw = compat?.model ?? "";
      const models = raw.split(",").map((m) => m.trim()).filter(Boolean).map((m) => ({ id: m, label: m }));
      setModelOptions(models);
      if (models.length > 0 && !models.some((m) => m.id === selectedModel)) {
        setSelectedModel(models[0].id);
      }
      setLoadingModels(false);
      return;
    }

    let cancelled = false;
    setLoadingModels(true);
    window.agentCompany.listConnectorModels(selectedConnectorId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setModelOptions(result.data);
        else setModelOptions([]);
      })
      .catch(() => { if (!cancelled) setModelOptions([]); })
      .finally(() => { if (!cancelled) setLoadingModels(false); });
    return () => { cancelled = true; };
  }, [selectedConnectorId]);

  /* ------------------------------------------------------------------ */
  /*  Provider callbacks (for ProvidersStep)                             */
  /* ------------------------------------------------------------------ */

  const handleTestConnector = useCallback(async (connectorId: string) => {
    try {
      unwrap(await window.agentCompany.testConnector(connectorId as ConnectorId));
    } catch {
      // Health check result is stored in DB and reflected via domain-changed
    }
  }, []);

  const handleSaveConnector = useCallback(async (connectorId: string, envBindingText: string, model: string | null, notes?: string) => {
    const connector = connectors.find((c) => c.id === connectorId);
    if (!connector) return;
    try {
      unwrap(await window.agentCompany.saveConnector({
        id: connectorId as ConnectorId,
        command: connector.command,
        model,
        envBindingText,
        notes: notes ?? connector.notes,
      }));
      // Run health check AFTER save completes so the probe uses the new config
      unwrap(await window.agentCompany.testConnector(connectorId as ConnectorId));
    } catch {
      // Error is non-fatal; result reflected via domain-changed
    }
  }, [connectors]);

  const handleLoginConnector = useCallback(async (connectorId: string) => {
    try {
      unwrap(await window.agentCompany.openConnectorAuthTerminal(connectorId as ConnectorId));
    } catch {
      // Terminal open failure is non-fatal
      return;
    }
    // Poll connector health after login terminal opens (same pattern as ConnectorEditor)
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      if (attempts > 12) { clearInterval(poll); return; }
      try {
        unwrap(await window.agentCompany.testConnector(connectorId as ConnectorId));
      } catch { /* health check result reflected via domain-changed */ }
    }, 5000);
  }, []);

  const handleInstallCommand = useCallback(async (title: string, command: string) => {
    try {
      unwrap(await window.agentCompany.openTerminalCommand({ title, command }));
    } catch {
      // Terminal open failure is non-fatal
      return;
    }
    // Poll all connectors after install (install may make a new CLI available)
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      if (attempts > 12) { clearInterval(poll); return; }
      for (const c of connectors) {
        if (c.status !== "ready") {
          try { unwrap(await window.agentCompany.testConnector(c.id as ConnectorId)); } catch { /* reflected via domain-changed */ }
        }
      }
    }, 5000);
  }, [connectors]);

  /* ------------------------------------------------------------------ */
  /*  Company / mission state                                            */
  /* ------------------------------------------------------------------ */

  const [companyName, setCompanyName] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [autoApproveHires, setAutoApproveHires] = useState(true);
  const [reviewDeliverables, setReviewDeliverables] = useState(false);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchSummary, setLaunchSummary] = useState<OnboardingBootstrapResult | null>(null);

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
      autoApproveHires,
      reviewDeliverables,
      goalTitle: goalTitle.trim(),
      goalDescription: goalDescription.trim(),
      connectorId: selectedConnector?.id,
      connectorModel: selectedModel.trim(),
    }));
    setLaunchSummary(result);
    setStep("launch");
  }, [
    autoApproveHires,
    reviewDeliverables,
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
    setStep("mission");
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

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

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
          <OnboardingHero
            step={heroStep}
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
                    onCheck={() => void checkNode()}
                    onInstall={(command) => void handleInstallCommand("Install Node.js", command)}
                    onContinue={() => { setError(null); setStep("providers"); }}
                    onBack={() => setStep("welcome")}
                    t={t}
                  />
                ) : null}

                {step === "providers" ? (
                  <ProvidersStep
                    connectors={connectors}
                    onTestConnector={(id) => void handleTestConnector(id)}
                    onSaveConnector={(id, env, model, notes) => void handleSaveConnector(id, env, model, notes)}
                    onLoginConnector={(id) => void handleLoginConnector(id)}
                    onInstallCommand={(title, cmd) => void handleInstallCommand(title, cmd)}
                    hasAtLeastOneReady={hasAtLeastOneReady}
                    onContinue={() => { setError(null); setStep("company"); }}
                    onBack={() => setStep("nodecheck")}
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
                    autoApproveHires={autoApproveHires}
                    setAutoApproveHires={setAutoApproveHires}
                    reviewDeliverables={reviewDeliverables}
                    setReviewDeliverables={setReviewDeliverables}
                    onPickDirectory={() => void pickDirectory()}
                    onContinue={() => void continueToMission()}
                    onBack={() => setStep("providers")}
                    error={error}
                    currentLocale={currentLocale}
                    t={t}
                  />
                ) : null}

                {step === "mission" ? (
                  <MissionStep
                    goalTitle={goalTitle}
                    setGoalTitle={setGoalTitle}
                    goalDescription={goalDescription}
                    setGoalDescription={setGoalDescription}
                    onLaunch={() => void launchCompany()}
                    onBack={() => setStep("company")}
                    loading={loading}
                    error={error}
                    t={t}
                  />
                ) : null}

                {step === "launch" && launchSummary ? (
                  <LaunchStep
                    launchSummary={launchSummary}
                    selectedConnector={selectedConnector}
                    onFinish={() => void finishLaunch()}
                    loading={loading}
                    error={error}
                    t={t}
                  />
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
