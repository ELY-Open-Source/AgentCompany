import { motion } from "framer-motion";
import { Cpu, Lightning } from "@phosphor-icons/react";
import { ActionButton, Input, TextArea } from "../ui";

interface MissionStepProps {
  goalTitle: string;
  setGoalTitle: (v: string) => void;
  goalDescription: string;
  setGoalDescription: (v: string) => void;
  onLaunch: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
  t: (key: string) => string;
}

export function MissionStep({
  goalTitle,
  setGoalTitle,
  goalDescription,
  setGoalDescription,
  onLaunch,
  onBack,
  loading,
  error,
  t,
}: MissionStepProps) {
  return (
    <motion.div
      key="mission"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="surface w-full rounded-[8px] p-7"
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
        <div className="mt-5 rounded-[8px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
        >
          {t("onboarding.back")}
        </button>
        <ActionButton
          label={loading ? t("onboarding.launching") : t("onboarding.launchCompany")}
          onClick={onLaunch}
          icon={Lightning}
          tone="accent"
          loading={loading}
          disabled={!goalTitle.trim()}
        />
      </div>
    </motion.div>
  );
}
