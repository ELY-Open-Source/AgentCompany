import { motion } from "framer-motion";
import {
  Buildings,
  CheckCircle,
  Rocket,
  Target,
} from "@phosphor-icons/react";
import type { ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { ConnectorReadiness } from "./ConnectorReadiness";

type Step = "language" | "company" | "mission" | "launch";

const STEP_LABELS_CONFIG = [
  { key: "onboarding.stepLabel1", icon: Buildings },
  { key: "onboarding.stepLabel2", icon: Target },
  { key: "onboarding.stepLabel3", icon: Rocket },
] as const;

interface OnboardingHeroProps {
  step: Step;
  connectors: ProfileSnapshot["connectors"];
  currentLocale: AppLocale;
  hasRunnableConnector: boolean;
  onOpenClaudeSettings: () => void;
  t: (key: string) => string;
}

export function OnboardingHero({
  step,
  connectors,
  currentLocale,
  hasRunnableConnector,
  onOpenClaudeSettings,
  t,
}: OnboardingHeroProps) {
  const stepIndex = step === "language" ? -1 : step === "company" ? 0 : step === "mission" ? 1 : 2;
  const stepLabels = STEP_LABELS_CONFIG.map((cfg) => ({
    label: t(cfg.key),
    icon: cfg.icon,
  }));

  return (
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

        <ConnectorReadiness
          connectors={connectors}
          currentLocale={currentLocale}
          hasRunnableConnector={hasRunnableConnector}
          onOpenClaudeSettings={onOpenClaudeSettings}
          t={t}
        />
      </motion.div>
    </div>
  );
}
