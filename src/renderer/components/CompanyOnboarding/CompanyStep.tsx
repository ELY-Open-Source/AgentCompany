import { motion } from "framer-motion";
import { Buildings, FolderOpen, Lightning, UserCircleCheck } from "@phosphor-icons/react";
import type { ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { ActionButton, Input, Select, TextArea } from "../ui";

interface CompanyStepProps {
  companyName: string;
  setCompanyName: (v: string) => void;
  companyDescription: string;
  setCompanyDescription: (v: string) => void;
  selectedConnectorId: string;
  setSelectedConnectorId: (v: string) => void;
  executionReadyConnectors: ProfileSnapshot["connectors"];
  workspacePath: string;
  setWorkspacePath: (v: string) => void;
  autoApproveHires: boolean;
  setAutoApproveHires: (v: boolean) => void;
  reviewDeliverables: boolean;
  setReviewDeliverables: (v: boolean) => void;
  onPickDirectory: () => void;
  onContinue: () => void;
  onBack: () => void;
  error: string | null;
  isFirstLaunch: boolean;
  selectedConnector: ProfileSnapshot["connectors"][number] | null;
  currentLocale: AppLocale;
  t: (key: string) => string;
}

export function CompanyStep({
  companyName,
  setCompanyName,
  companyDescription,
  setCompanyDescription,
  selectedConnectorId: _selectedConnectorId,
  setSelectedConnectorId,
  executionReadyConnectors,
  workspacePath,
  setWorkspacePath,
  autoApproveHires,
  setAutoApproveHires,
  reviewDeliverables,
  setReviewDeliverables,
  onPickDirectory,
  onContinue,
  onBack,
  error,
  isFirstLaunch,
  selectedConnector,
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
      className="surface w-full rounded-[8px] p-7"
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
        <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-[12px] leading-relaxed text-[color:var(--muted)]">
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
            <ActionButton label={currentLocale === "zh" ? "选择" : "Choose"} onClick={onPickDirectory} icon={FolderOpen} />
          </div>
          <div className="mt-1.5 text-[11px] text-[color:var(--muted)]">
            {t("onboarding.workspaceHelp")}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[12px] font-medium text-[color:var(--muted-strong)]">{t("onboarding.automationMode")}</div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => { setReviewDeliverables(false); setAutoApproveHires(true) }}
              className={`cursor-pointer rounded-[8px] border-2 px-4 py-3.5 text-left transition ${!reviewDeliverables ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]" : "border-[color:var(--line)] bg-[color:var(--panel-soft)] hover:border-[color:var(--muted)]"}`}
            >
              <Lightning size={20} weight={!reviewDeliverables ? "fill" : "regular"} className={!reviewDeliverables ? "text-[color:var(--accent)]" : "text-[color:var(--muted)]"} />
              <div className="mt-2 text-[13px] font-semibold text-[color:var(--text)]">{t("onboarding.modeFullAuto")}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-[color:var(--muted)]">{t("onboarding.modeFullAutoDesc")}</div>
            </button>
            <button
              type="button"
              onClick={() => { setReviewDeliverables(true); setAutoApproveHires(false) }}
              className={`cursor-pointer rounded-[8px] border-2 px-4 py-3.5 text-left transition ${reviewDeliverables ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]" : "border-[color:var(--line)] bg-[color:var(--panel-soft)] hover:border-[color:var(--muted)]"}`}
            >
              <UserCircleCheck size={20} weight={reviewDeliverables ? "fill" : "regular"} className={reviewDeliverables ? "text-[color:var(--accent)]" : "text-[color:var(--muted)]"} />
              <div className="mt-2 text-[13px] font-semibold text-[color:var(--text)]">{t("onboarding.modeHumanReview")}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-[color:var(--muted)]">{t("onboarding.modeHumanReviewDesc")}</div>
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-[8px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="mt-8 flex items-center justify-between">
        {isFirstLaunch ? (
          <button
            type="button"
            onClick={onBack}
            className="text-[12px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
          >
            {t("onboarding.back")}
          </button>
        ) : <div />}
        <ActionButton
          label={t("onboarding.continue")}
          onClick={onContinue}
          icon={Buildings}
          tone="accent"
          disabled={!companyName.trim() || !selectedConnector}
        />
      </div>
    </motion.div>
  );
}
