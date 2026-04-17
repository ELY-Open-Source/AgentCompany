import { motion } from "framer-motion";
import { Cpu, Lightning } from "../ui/icons";
import { ActionButton, Input, TextArea } from "../ui";
import { getStepNumber, TOTAL_STEPS } from "./OnboardingHero";
import { useOnboarding } from "./OnboardingContext";

interface MissionStepProps {
  onLaunch: () => void;
  onBack: () => void;
}

export function MissionStep({ onLaunch, onBack }: MissionStepProps) {
  const {
    goalTitle,
    setGoalTitle,
    goalDescription,
    setGoalDescription,
    loading,
    error,
    t,
  } = useOnboarding();

  return (
    <motion.div
      key="mission"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="bg-card border border-border shadow-sm w-full rounded-lg p-7"
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t("onboarding.stepLabelMission")} {getStepNumber("mission")} / {TOTAL_STEPS}
      </div>
      <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-foreground">
        {t("onboarding.step2Title")}
      </div>
      <div className="mb-6 h-px bg-[color:var(--border)]" />

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
        <div className="rounded-lg border border-border bg-muted px-4 py-3 text-[12px] text-muted-foreground">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
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
