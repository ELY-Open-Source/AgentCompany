import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Buildings,
  CheckCircle,
  Cpu,
  FolderOpen,
  GearSix,
  GlobeSimple,
  Lightning,
  Rocket,
  Target,
  WarningCircle,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { getConnectorExecutionReadinessIssue, isConnectorExecutionReady } from "@shared/connector-policy";
import type { OnboardingBootstrapResult, ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { APP_LOCALES, LOCALE_LABELS } from "@shared/locale";
import { useT } from "../i18n";
import { unwrap } from "../lib/desktop";
import { ActionButton, Input, Select, TextArea } from "./ui";

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

  const stepLabels = [
    { label: t("onboarding.stepLabel1"), icon: Buildings },
    { label: t("onboarding.stepLabel2"), icon: Target },
    { label: t("onboarding.stepLabel3"), icon: Rocket },
  ] as const;
  const stepIndex = step === "language" ? -1 : step === "company" ? 0 : step === "mission" ? 1 : 2;

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
      goalTitle: goalTitle.trim(),
      goalDescription: goalDescription.trim(),
      connectorId: selectedConnector?.id,
    }));
    setLaunchSummary(result);
    setStep("launch");
  }, [
    autoApproveHires,
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
    <div className="grid min-h-[100dvh] overflow-hidden bg-[color:var(--bg)] md:grid-cols-[minmax(0,1fr)_540px]">
      <div className="flex min-h-0 items-center justify-center overflow-y-auto px-8 py-12 md:px-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto w-full max-w-[460px]"
        >
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
            {t("onboarding.subtitle")}
          </div>
          <h1 className="text-[38px] leading-[0.98] tracking-[-0.03em] text-[color:var(--text)] md:text-[48px]">
            {t("onboarding.title").split("\n").map((line, i) => (
              <span key={i}>{line}{i === 0 ? <br /> : null}</span>
            ))}
          </h1>
          <p className="mt-4 max-w-[400px] text-[14px] leading-relaxed text-[color:var(--muted)]">
            {t("onboarding.description")}
          </p>

          {step !== "language" ? (
            <div className="mt-10 flex items-center gap-3">
              {stepLabels.map((entry, index) => (
                <div key={entry.label} className="flex items-center gap-2">
                  {index > 0 ? (
                    <div className={`h-px w-6 ${index <= stepIndex ? "bg-[color:var(--accent)]" : "bg-[color:var(--line)]"}`} />
                  ) : null}
                  <div
                    className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${
                      index < stepIndex
                        ? "bg-[color:var(--success-soft)] text-[color:var(--success)]"
                        : index === stepIndex
                          ? "bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                          : "bg-[color:var(--panel-soft)] text-[color:var(--muted)]"
                    }`}
                  >
                    {index < stepIndex ? <CheckCircle size={14} weight="fill" /> : <entry.icon size={14} />}
                    {entry.label}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-10">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
              {t("onboarding.connectorReadiness")}
            </div>
            <div className="space-y-2.5">
              {connectors.map((connector) => {
                const isChecking = connector.status === "detected";
                const isReady = connector.status === "ready";
                const isMissing = connector.status === "not_installed";
                const issue = !isChecking ? getConnectorExecutionReadinessIssue(connector) : null;
                return (
                  <div key={connector.id} className="flex items-start gap-2.5 text-[13px]">
                    {isChecking ? (
                      <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[color:var(--muted)] border-t-[color:var(--accent)]" />
                    ) : isReady ? (
                      <CheckCircle size={16} weight="fill" className="shrink-0 text-[color:var(--success)]" />
                    ) : isMissing ? (
                      <XCircle size={16} weight="fill" className="shrink-0 text-[color:var(--muted)]" />
                    ) : (
                      <WarningCircle size={16} weight="fill" className="shrink-0 text-[color:var(--warn)]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={isReady ? "font-medium text-[color:var(--text)]" : isChecking ? "text-[color:var(--text)]" : "text-[color:var(--muted)]"}>
                          {connector.label}
                        </span>
                        <span className="text-[11px] text-[color:var(--muted)]">
                          {isChecking ? (currentLocale === "zh" ? "检测中..." : "checking...") : connector.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      {issue ? (
                        <div className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--muted)]">
                          {issue}
                        </div>
                      ) : null}
                    </div>
                    {connector.id === "claude_local" ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openClaudeSettings(); }}
                        className="shrink-0 rounded-[6px] p-1.5 text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
                        title={currentLocale === "zh" ? "Claude Code 设置" : "Claude Code Settings"}
                      >
                        <GearSix size={14} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {!hasRunnableConnector ? (
              <div className="mt-4 rounded-[10px] border border-[color:var(--warn)] bg-[color:var(--warn-soft)] px-4 py-3 text-[12px] text-[color:var(--warn)]">
                {t("onboarding.connectorWarning")}
              </div>
            ) : null}
          </div>
        </motion.div>
      </div>

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
              <motion.div
                key="language"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                className="surface w-full rounded-[12px] p-7"
              >
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
                  <GlobeSimple size={12} />
                  {t("onboarding.languageSelection")} / Language
                </div>
                <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--text)]">
                  {t("onboarding.selectLanguage")} / Select Language
                </div>
                <div className="mb-6 h-px bg-[color:var(--line)]" />

                <div className="space-y-2.5">
                  {APP_LOCALES.map((locale) => (
                    <button
                      key={locale}
                      type="button"
                      onClick={() => onLocaleChange(locale)}
                      className={`flex w-full items-center gap-3 rounded-[10px] border px-4 py-3.5 text-left transition ${
                        currentLocale === locale
                          ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
                          : "border-[color:var(--line)] bg-[color:var(--panel-soft)] hover:border-[color:var(--muted)]"
                      }`}
                    >
                      <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        currentLocale === locale
                          ? "border-[color:var(--accent)] bg-[color:var(--accent)]"
                          : "border-[color:var(--line)]"
                      }`}>
                        {currentLocale === locale ? <CheckCircle size={14} weight="fill" className="text-white" /> : null}
                      </div>
                      <span className={`text-[14px] font-medium ${
                        currentLocale === locale ? "text-[color:var(--text)]" : "text-[color:var(--muted-strong)]"
                      }`}>
                        {LOCALE_LABELS[locale]}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="mt-8 flex items-center justify-end">
                  <ActionButton
                    label={t("onboarding.continue")}
                    onClick={() => setStep("company")}
                    icon={GlobeSimple}
                    tone="accent"
                  />
                </div>
              </motion.div>
            ) : null}

            {step === "company" ? (
              <motion.div
                key="company"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                className="surface w-full rounded-[12px] p-7"
              >
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
                  {t("onboarding.stepLabel1")} 1 / 3
                </div>
                <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--text)]">
                  {t("onboarding.step1Title")}
                </div>
                <div className="mb-6 h-px bg-[color:var(--line)]" />

                <div className="space-y-4">
                  <Input
                    label={t("onboarding.companyName")}
                    value={companyName}
                    onChange={setCompanyName}
                    placeholder={t("onboarding.companyNamePlaceholder")}
                  />
                  <TextArea
                    label={t("onboarding.companyDescription")}
                    value={companyDescription}
                    onChange={setCompanyDescription}
                    placeholder={t("onboarding.companyDescriptionPlaceholder")}
                    rows={3}
                  />
                  <Select
                    label={t("onboarding.primaryConnector")}
                    value={selectedConnector?.id ?? ""}
                    onChange={setSelectedConnectorId}
                    options={executionReadyConnectors.map((connector) => ({
                      value: connector.id,
                      label: connector.label,
                    }))}
                  />
                  <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-[12px] leading-relaxed text-[color:var(--muted)]">
                    {t("onboarding.connectorInfo")}
                  </div>
                  <div>
                    <label
                      htmlFor="onboarding-workspace-path"
                      className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]"
                    >
                      {t("onboarding.workspaceFolder")} <span className="font-normal text-[color:var(--muted)]">{t("onboarding.workspaceFolderOptional")}</span>
                    </label>
                    <div className="flex gap-3">
                      <Input
                        id="onboarding-workspace-path"
                        ariaLabel={t("onboarding.workspaceFolder")}
                        value={workspacePath}
                        onChange={setWorkspacePath}
                        placeholder={t("onboarding.workspaceFolderPlaceholder")}
                      />
                      <ActionButton label={currentLocale === "zh" ? "选择" : "Choose"} onClick={() => void pickDirectory()} icon={FolderOpen} />
                    </div>
                    <div className="mt-1.5 text-[11px] text-[color:var(--muted)]">
                      {t("onboarding.workspaceHelp")}
                    </div>
                  </div>
                  <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={autoApproveHires}
                        onChange={(event) => setAutoApproveHires(event.target.checked)}
                        className="h-4 w-4 rounded border-[color:var(--line)] accent-[color:var(--accent)]"
                      />
                      <div>
                        <div className="text-[13px] font-medium text-[color:var(--text)]">{t("onboarding.autoApproveLabel")}</div>
                        <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                          {t("onboarding.autoApproveHelp")}
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {error ? (
                  <div className="mt-5 rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
                    {error}
                  </div>
                ) : null}

                <div className="mt-8 flex items-center justify-between">
                  {isFirstLaunch ? (
                    <button
                      type="button"
                      onClick={() => setStep("language")}
                      className="text-[12px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                    >
                      {t("onboarding.back")}
                    </button>
                  ) : <div />}
                  <ActionButton
                    label={t("onboarding.continue")}
                    onClick={() => void continueToMission()}
                    icon={Buildings}
                    tone="accent"
                    disabled={!companyName.trim() || !selectedConnector}
                  />
                </div>
              </motion.div>
            ) : null}

            {step === "mission" ? (
              <motion.div
                key="mission"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                className="surface w-full rounded-[12px] p-7"
              >
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
                  {t("onboarding.stepLabel2")} 2 / 3
                </div>
                <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--text)]">
                  {t("onboarding.step2Title")}
                </div>
                <div className="mb-6 h-px bg-[color:var(--line)]" />

                <div className="space-y-4">
                  <Input
                    label={t("onboarding.goal")}
                    value={goalTitle}
                    onChange={setGoalTitle}
                    placeholder={t("onboarding.goalPlaceholder")}
                  />
                  <TextArea
                    label={t("onboarding.acceptanceCriteria")}
                    value={goalDescription}
                    onChange={setGoalDescription}
                    placeholder={t("onboarding.acceptanceCriteriaPlaceholder")}
                    rows={5}
                  />
                  <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-[12px] text-[color:var(--muted)]">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">
                      <Cpu size={12} />
                      {t("onboarding.executionHandoff")}
                    </div>
                    <div className="space-y-2">
                      <div>{t("onboarding.executionHandoffLine1")}</div>
                      <div>{t("onboarding.executionHandoffLine2")}</div>
                      <div>{t("onboarding.executionHandoffLine3")}</div>
                    </div>
                  </div>
                </div>

                {error ? (
                  <div className="mt-5 rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
                    {error}
                  </div>
                ) : null}

                <div className="mt-8 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setStep("company")}
                    className="text-[12px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                  >
                    {t("onboarding.back")}
                  </button>
                  <ActionButton
                    label={loading ? t("onboarding.launching") : t("onboarding.launchCompany")}
                    onClick={() => void launchCompany()}
                    icon={Lightning}
                    tone="accent"
                    loading={loading}
                    disabled={!goalTitle.trim()}
                  />
                </div>
              </motion.div>
            ) : null}

            {step === "launch" && launchSummary ? (
              <motion.div
                key="launch"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
                className="surface w-full rounded-[12px] p-7"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--success-soft)] text-[color:var(--success)]">
                  <CheckCircle size={24} weight="fill" />
                </div>
                <h2 className="mt-5 text-[28px] tracking-[-0.03em] text-[color:var(--text)]">
                  {launchSummary.companyName} {t("onboarding.isLive")}
                </h2>
                <p className="mt-3 text-[14px] leading-relaxed text-[color:var(--muted)]">
                  {launchSummary.runId ? t("onboarding.launchDescription") : t("onboarding.launchDescriptionDeferred")}
                </p>

                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("onboarding.connector")}</div>
                    <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
                      {selectedConnector?.label ?? t("onboarding.unavailable")}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("onboarding.leadAgent")}</div>
                    <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
                      {launchSummary.leadAgentId ? t("onboarding.ceoAgentCreated") : t("onboarding.leadAgentUnavailable")}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("onboarding.primaryWorkspace")}</div>
                    <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
                      {launchSummary.workspaceId ? t("onboarding.registered") : t("onboarding.notBound")}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("onboarding.kickoffProject")}</div>
                    <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
                      {launchSummary.projectId ? t("onboarding.created") : t("onboarding.unavailable")}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("onboarding.initialRun")}</div>
                    <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
                      {launchSummary.runId ? t("onboarding.queuedInOrchestration") : t("onboarding.deferredUntilReady")}
                    </div>
                  </div>
                </div>

                {error ? (
                  <div className="mt-5 rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
                    {error}
                  </div>
                ) : null}

                <div className="mt-8 flex items-center justify-end">
                  <ActionButton
                    label={loading ? t("onboarding.opening") : t("onboarding.openControlCenter")}
                    onClick={() => void finishLaunch()}
                    icon={Rocket}
                    tone="accent"
                    loading={loading}
                  />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {claudeSettingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--bg)]/72 backdrop-blur-sm" onClick={() => setClaudeSettingsOpen(false)}>
          <div className="w-full max-w-[420px] rounded-[12px] border border-[color:var(--line)] bg-[color:var(--panel)] p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-[color:var(--text)]">Claude Code {currentLocale === "zh" ? "设置" : "Settings"}</h3>
              <button type="button" onClick={() => setClaudeSettingsOpen(false)} className="rounded-[6px] p-1 text-[color:var(--muted)] transition hover:text-[color:var(--text)]"><X size={16} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">API Key</label>
                <input
                  type="password"
                  className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2.5 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
                  value={claudeApiKey}
                  onChange={(e) => setClaudeApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                />
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">{currentLocale === "zh" ? "留空使用订阅认证" : "Leave empty to use subscription auth"}</div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">Base URL</label>
                <input
                  className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2.5 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
                  value={claudeBaseUrl}
                  onChange={(e) => setClaudeBaseUrl(e.target.value)}
                  placeholder="https://api.anthropic.com"
                />
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">{currentLocale === "zh" ? "留空使用默认端点" : "Leave empty for default endpoint"}</div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">Model</label>
                <input
                  className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2.5 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
                  value={claudeModel}
                  onChange={(e) => setClaudeModel(e.target.value)}
                  placeholder="claude-sonnet-4-20250514"
                />
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">{currentLocale === "zh" ? "留空使用连接器默认模型" : "Leave empty for connector default"}</div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setClaudeSettingsOpen(false)} className="rounded-[8px] px-4 py-2 text-[13px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]">
                {currentLocale === "zh" ? "取消" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void saveClaudeSettings()}
                disabled={claudeSettingsSaving}
                className="rounded-[8px] bg-[color:var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {claudeSettingsSaving ? (currentLocale === "zh" ? "保存中..." : "Saving...") : (currentLocale === "zh" ? "保存" : "Save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
