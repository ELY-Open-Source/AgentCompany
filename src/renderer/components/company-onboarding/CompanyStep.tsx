import { motion } from "framer-motion";
import { Buildings, FolderOpen } from "@phosphor-icons/react";
import type { ConnectorId, ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { ActionButton, Input, TextArea, Select } from "../ui";
import { getStepNumber, TOTAL_STEPS } from "./OnboardingHero";

interface CompanyStepProps {
  companyName: string;
  setCompanyName: (v: string) => void;
  companyDescription: string;
  setCompanyDescription: (v: string) => void;
  selectedConnectorId: ConnectorId | "";
  setSelectedConnectorId: (v: ConnectorId | "") => void;
  selectedModel: string;
  setSelectedModel: (v: string) => void;
  executionReadyConnectors: ProfileSnapshot["connectors"];
  modelOptions: Array<{ id: string; label: string }>;
  loadingModels: boolean;
  workspacePath: string;
  setWorkspacePath: (v: string) => void;
  onPickDirectory: () => void;
  onContinue: () => void;
  onBack: () => void;
  error: string | null;
  currentLocale: AppLocale;
  t: (key: string) => string;
}

export function CompanyStep({
  companyName,
  setCompanyName,
  companyDescription,
  setCompanyDescription,
  selectedConnectorId,
  setSelectedConnectorId,
  selectedModel,
  setSelectedModel,
  executionReadyConnectors,
  modelOptions,
  loadingModels,
  workspacePath,
  setWorkspacePath,
  onPickDirectory,
  onContinue,
  onBack,
  error,
  currentLocale,
  t,
}: CompanyStepProps) {
  return (
    <motion.div
      key="company"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="bg-card border border-border shadow-sm w-full rounded-lg p-7"
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t("onboarding.stepLabelCompany")} {getStepNumber("company")} / {TOTAL_STEPS}
      </div>
      <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-foreground">
        {t("onboarding.step1Title")}
      </div>
      <div className="mb-6 h-px bg-[color:var(--border)]" />

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

        {/* CEO Provider + Model */}
        <div>
          <div className="mb-2 text-[12px] font-medium text-muted-foreground">
            {currentLocale === "zh" ? "CEO 运行时" : "CEO Runtime"}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label={currentLocale === "zh" ? "提供商" : "Provider"}
              value={selectedConnectorId}
              onChange={(value) => setSelectedConnectorId(value as ConnectorId | "")}
              options={executionReadyConnectors.map((c) => ({
                value: c.id,
                label: c.id.startsWith("claude_compat") && c.notes ? `${c.notes}` : c.label,
              }))}
            />
            <Select
              label={currentLocale === "zh" ? "模型" : "Model"}
              value={selectedModel}
              onChange={setSelectedModel}
              disabled={loadingModels || modelOptions.length === 0}
              options={[
                { value: "", label: loadingModels ? (currentLocale === "zh" ? "加载中..." : "Loading...") : (currentLocale === "zh" ? "默认" : "Default") },
                ...modelOptions.map((m) => ({ value: m.id, label: m.label })),
              ]}
            />
          </div>
          <div className="mt-3 rounded-lg border border-border bg-background/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            {t("onboarding.companyStepModelPoolHint")}
          </div>
        </div>

        <div>
          <label
            htmlFor="onboarding-workspace-path"
            className="mb-1.5 block text-[12px] font-medium text-muted-foreground"
          >
            {t("onboarding.workspaceFolder")} <span className="font-normal text-muted-foreground">{t("onboarding.workspaceFolderOptional")}</span>
          </label>
          <div className="flex gap-3">
            <Input
              id="onboarding-workspace-path"
              ariaLabel={t("onboarding.workspaceFolder")}
              value={workspacePath}
              onChange={setWorkspacePath}
              placeholder={t("onboarding.workspaceFolderPlaceholder")}
            />
            <ActionButton label={currentLocale === "zh" ? "选择" : "Choose"} onClick={onPickDirectory} icon={FolderOpen} />
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            {t("onboarding.workspaceHelp")}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-lg border border-[color:var(--destructive)] bg-destructive-muted px-4 py-3 text-[13px] text-destructive">
          {error}
        </div>
      ) : null}

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
          icon={Buildings}
          tone="accent"
          disabled={!companyName.trim() || !selectedConnectorId}
        />
      </div>
    </motion.div>
  );
}
