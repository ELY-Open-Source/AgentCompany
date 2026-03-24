import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { isConnectorExecutionReady } from "@shared/connector-policy";
import type { OnboardingBootstrapResult, ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { useT } from "../../i18n";
import { unwrap } from "../../lib/desktop";
import { OnboardingHero } from "./OnboardingHero";
import { LanguageStep } from "./LanguageStep";
import { CompanyStep } from "./CompanyStep";
import { MissionStep } from "./MissionStep";
import { LaunchStep } from "./LaunchStep";
import { ClaudeSettingsDialog } from "./ClaudeSettingsDialog";

type Step = "language" | "company" | "mission" | "launch";

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
  const [step, setStep] = useState<Step>(isFirstLaunch ? "language" : "company");
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
  const [claudeSettingsOpen, setClaudeSettingsOpen] = useState(false);
  const [claudeApiKey, setClaudeApiKey] = useState("");
  const [claudeBaseUrl, setClaudeBaseUrl] = useState("");
  const [claudeModel, setClaudeModel] = useState("");
  const [claudeSettingsSaving, setClaudeSettingsSaving] = useState(false);

  const executionReadyConnectors = useMemo(
    () => connectors.filter((connector) => isConnectorExecutionReady(connector)),
    [connectors],
  );
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>(executionReadyConnectors[0]?.id ?? "");
  const hasRunnableConnector = executionReadyConnectors.length > 0;
  const selectedConnector =
    executionReadyConnectors.find((connector) => connector.id === selectedConnectorId) ?? executionReadyConnectors[0] ?? null;

  useEffect(() => {
    if (!selectedConnectorId && executionReadyConnectors[0]) {
      setSelectedConnectorId(executionReadyConnectors[0].id);
      return;
    }
    if (selectedConnectorId && !executionReadyConnectors.some((connector) => connector.id === selectedConnectorId)) {
      setSelectedConnectorId(executionReadyConnectors[0]?.id ?? "");
    }
  }, [executionReadyConnectors, selectedConnectorId]);

  const openClaudeSettings = useCallback(() => {
    const claude = connectors.find((c) => c.id === "claude_local");
    if (!claude) return;
    const lines = claude.envBindingText.split(/\r?\n/);
    setClaudeApiKey(lines.find((l) => l.startsWith("ANTHROPIC_API_KEY="))?.split("=").slice(1).join("=") ?? "");
    setClaudeBaseUrl(lines.find((l) => l.startsWith("ANTHROPIC_BASE_URL="))?.split("=").slice(1).join("=") ?? "");
    setClaudeModel(claude.model ?? "");
    setClaudeSettingsOpen(true);
  }, [connectors]);

  const saveClaudeSettings = useCallback(async () => {
    setClaudeSettingsSaving(true);
    try {
      const envLines: string[] = [];
      if (claudeApiKey.trim()) envLines.push(`ANTHROPIC_API_KEY=${claudeApiKey.trim()}`);
      if (claudeBaseUrl.trim()) envLines.push(`ANTHROPIC_BASE_URL=${claudeBaseUrl.trim()}`);
      const claude = connectors.find((c) => c.id === "claude_local");
      if (!claude) return;
      const existingLines = claude.envBindingText.split(/\r?\n/).filter((l) => {
        const key = l.split("=")[0]?.trim();
        return key && key !== "ANTHROPIC_API_KEY" && key !== "ANTHROPIC_BASE_URL" && l.trim();
      });
      const newEnvText = [...envLines, ...existingLines].join("\n");
      unwrap(await window.agentCompany.saveConnector({
        id: "claude_local",
        command: claude.command,
        model: claudeModel.trim() || null,
        envBindingText: newEnvText,
        notes: claude.notes,
      }));
      setClaudeSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClaudeSettingsSaving(false);
    }
  }, [claudeApiKey, claudeBaseUrl, claudeModel, connectors]);

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
    workspacePath,
  ]);

  const continueToMission = useCallback(async () => {
    if (loading) return;
    if (!companyName.trim()) {
      setError(t("onboarding.enterCompanyName"));
      return;
    }
    if (!selectedConnector) {
      setError(t("onboarding.connectorRequired"));
      return;
    }
    setError(null);
    setStep("mission");
  }, [companyName, loading, selectedConnector, t]);

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

  return (
    <div className="relative grid min-h-[100dvh] overflow-hidden bg-[color:var(--bg)] md:grid-cols-[minmax(0,1fr)_540px]">
      {/* Drag region for macOS frameless title bar */}
      <div className="sidebar-drag absolute inset-x-0 top-0 z-10 h-[38px]" />
      <OnboardingHero
        step={step}
        connectors={connectors}
        currentLocale={currentLocale}
        hasRunnableConnector={hasRunnableConnector}
        onOpenClaudeSettings={openClaudeSettings}
        t={t}
      />

      <div className="min-h-0 overflow-y-auto border-l border-[color:var(--line)] bg-[color:var(--bg-subtle)]">
        <div className="relative flex min-h-full items-center px-6 py-10 md:px-10">
          {canCancel && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="absolute right-6 top-6 text-[12px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
            >
              {t("onboarding.cancel")}
            </button>
          ) : null}

          <AnimatePresence mode="wait">
            {step === "language" ? (
              <LanguageStep
                currentLocale={currentLocale}
                onLocaleChange={onLocaleChange}
                onContinue={() => setStep("company")}
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
                executionReadyConnectors={executionReadyConnectors}
                workspacePath={workspacePath}
                setWorkspacePath={setWorkspacePath}
                autoApproveHires={autoApproveHires}
                setAutoApproveHires={setAutoApproveHires}
                reviewDeliverables={reviewDeliverables}
                setReviewDeliverables={setReviewDeliverables}
                onPickDirectory={() => void pickDirectory()}
                onContinue={() => void continueToMission()}
                onBack={() => setStep("language")}
                error={error}
                isFirstLaunch={isFirstLaunch}
                selectedConnector={selectedConnector}
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

      {claudeSettingsOpen ? (
        <ClaudeSettingsDialog
          claudeApiKey={claudeApiKey}
          setClaudeApiKey={setClaudeApiKey}
          claudeBaseUrl={claudeBaseUrl}
          setClaudeBaseUrl={setClaudeBaseUrl}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          onSave={() => void saveClaudeSettings()}
          onClose={() => setClaudeSettingsOpen(false)}
          saving={claudeSettingsSaving}
          currentLocale={currentLocale}
        />
      ) : null}
    </div>
  );
}
