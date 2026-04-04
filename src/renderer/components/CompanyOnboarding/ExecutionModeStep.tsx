import { motion } from "framer-motion";
import { ArrowRight, Brain, UserCircle, type Icon } from "@phosphor-icons/react";
import type { ExecutionMode } from "@shared/types";

interface ExecutionModeStepProps {
  executionMode: ExecutionMode;
  setExecutionMode: (mode: ExecutionMode) => void;
  onContinue: () => void;
  onBack: () => void;
  t: (key: string) => string;
}

export function ExecutionModeStep({
  executionMode,
  setExecutionMode,
  onContinue,
  onBack,
  t,
}: ExecutionModeStepProps) {
  return (
    <motion.div
      key="executionmode"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="bg-card border border-border shadow-sm w-full rounded-lg p-7"
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t("onboarding.stepLabelMode")} 5 / 6
      </div>
      <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-foreground">
        {t("onboarding.modeStepTitle")}
      </div>
      <div className="mb-6 h-px bg-[color:var(--border)]" />

      <div className="space-y-3">
        <ModeCard
          selected={executionMode === "ai_ceo"}
          onSelect={() => setExecutionMode("ai_ceo")}
          icon={Brain}
          title={t("onboarding.modeAiCeoTitle")}
          subtitle={t("onboarding.modeAiCeoSubtitle")}
          description={t("onboarding.modeAiCeoDesc")}
        />
        <ModeCard
          selected={executionMode === "ai_cofounder"}
          onSelect={() => setExecutionMode("ai_cofounder")}
          icon={UserCircle}
          title={t("onboarding.modeCofounderTitle")}
          subtitle={t("onboarding.modeCofounderSubtitle")}
          description={t("onboarding.modeCofounderDesc")}
        />
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        {t("onboarding.modeCanChange")}
      </p>

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          {t("onboarding.back")}
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="flex items-center gap-2 rounded-md bg-[color:var(--primary)] px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90"
        >
          {t("onboarding.continue")}
          <ArrowRight size={14} />
        </button>
      </div>
    </motion.div>
  );
}

function ModeCard({
  selected,
  onSelect,
  icon: Icon,
  title,
  subtitle,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: Icon;
  title: string;
  subtitle: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border px-4 py-4 text-left transition ${
        selected
          ? "border-[color:var(--primary)] bg-[color:var(--primary)]/5 ring-1 ring-[color:var(--primary)]"
          : "border-border bg-background hover:border-muted-foreground/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 rounded-md p-1.5 ${
            selected
              ? "bg-[color:var(--primary)]/10 text-[color:var(--primary)]"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[14px] font-semibold text-foreground">{title}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${
                selected
                  ? "bg-[color:var(--primary)]/10 text-[color:var(--primary)]"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {subtitle}
            </span>
          </div>
          <p className="text-[12px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div
          className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 transition ${
            selected
              ? "border-[color:var(--primary)] bg-[color:var(--primary)]"
              : "border-border bg-background"
          }`}
        />
      </div>
    </button>
  );
}
