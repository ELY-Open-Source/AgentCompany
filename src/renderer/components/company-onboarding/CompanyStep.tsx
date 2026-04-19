import { useCallback, useState } from "react";
import { Buildings, FolderOpen } from "../ui/icons";
import type { ConnectorId } from "@shared/types";
import { ActionButton, Input, TextArea, Select } from "../ui";
import { OnboardingStep } from "./OnboardingStep";
import {
  useOnboardingConnectors,
  useOnboardingWizard,
} from "./OnboardingContext";

export interface CompanyStepValues {
  companyName: string;
  companyDescription: string;
  workspacePath: string;
}

interface CompanyStepProps {
  initialValues: CompanyStepValues;
  onPickDirectory: () => Promise<string | null>;
  onContinue: (values: CompanyStepValues) => void;
  onBack: () => void;
}

export function CompanyStep({
  initialValues,
  onPickDirectory,
  onContinue,
  onBack,
}: CompanyStepProps) {
  const { currentLocale, t, error } = useOnboardingWizard();
  const {
    selectedConnectorId,
    setSelectedConnectorId,
    selectedModel,
    setSelectedModel,
    executionReadyConnectors,
    modelOptions,
    loadingModels,
  } = useOnboardingConnectors();

  const [companyName, setCompanyName] = useState(initialValues.companyName);
  const [companyDescription, setCompanyDescription] = useState(initialValues.companyDescription);
  const [workspacePath, setWorkspacePath] = useState(initialValues.workspacePath);

  const handlePick = useCallback(async () => {
    const picked = await onPickDirectory();
    if (picked) setWorkspacePath(picked);
  }, [onPickDirectory]);

  const handleContinue = useCallback(() => {
    onContinue({ companyName, companyDescription, workspacePath });
  }, [companyName, companyDescription, workspacePath, onContinue]);

  return (
    <OnboardingStep
      step="company"
      eyebrow={t("onboarding.stepLabelCompany")}
      title={t("onboarding.step1Title")}
    >
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

        {/* CEO Provider + Model — stacked so long names (`Fireworks AI`,
            `Kimi K2.5 Turbo Preview 0911`) are readable without the
            two-column ellipsis truncation that the 540-px panel forced. */}
        <div>
          <div className="mb-2 text-[12px] font-medium text-muted-foreground">
            {currentLocale === "zh" ? "CEO 运行时" : "CEO Runtime"}
          </div>
          <div className="space-y-3">
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
              options={
                loadingModels
                  ? [{ value: "", label: currentLocale === "zh" ? "加载中..." : "Loading..." }]
                  : modelOptions.map((m) => ({ value: m.id, label: m.label }))
              }
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
            {t("onboarding.workspaceFolder")}{" "}
            <span className="font-normal text-muted-foreground">
              {t("onboarding.workspaceFolderOptional")}
            </span>
          </label>
          <div className="flex items-stretch gap-3">
            <div className="min-w-0 flex-1">
              <Input
                id="onboarding-workspace-path"
                ariaLabel={t("onboarding.workspaceFolder")}
                value={workspacePath}
                onChange={setWorkspacePath}
                placeholder={t("onboarding.workspaceFolderPlaceholder")}
              />
            </div>
            <ActionButton
              label={currentLocale === "zh" ? "选择" : "Choose"}
              onClick={() => void handlePick()}
              icon={FolderOpen}
            />
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
          onClick={handleContinue}
          icon={Buildings}
          tone="accent"
          disabled={!companyName.trim() || !selectedConnectorId}
        />
      </div>
    </OnboardingStep>
  );
}
