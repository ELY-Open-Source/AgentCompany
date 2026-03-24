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
import { AsciiAnimation } from "./AsciiAnimation";

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
    <div className="relative flex min-h-0 items-center justify-center overflow-y-auto px-8 py-12 md:px-16">
      {/* Ambient gradient - subtle animated accent wash */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 30% 20%, var(--accent) 0%, transparent 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          background: "radial-gradient(ellipse 60% 80% at 70% 80%, var(--accent) 0%, transparent 70%)",
          animation: "hero-drift 12s ease-in-out infinite alternate",
        }}
      />

      {/* ASCII agent activity backdrop */}
      <AsciiAnimation />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 mx-auto w-full max-w-[460px]"
      >
        {/* Signature line */}
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6 flex items-center gap-3"
        >
          <div
            className="h-px flex-1 max-w-[32px]"
            style={{
              background: "linear-gradient(90deg, var(--accent), transparent)",
            }}
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted)]">
            {t("onboarding.subtitle")}
          </span>
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="text-[36px] font-bold leading-[1.05] tracking-[-0.03em] text-[color:var(--text)] md:text-[44px]"
        >
          {t("onboarding.title").split("\n").map((line, i) => (
            <span key={i}>{line}{i === 0 ? <br /> : null}</span>
          ))}
        </motion.h1>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mt-4 max-w-[400px] text-[14px] leading-relaxed text-[color:var(--muted)]"
        >
          {t("onboarding.description")}
        </motion.p>

        {/* Step progress */}
        {step !== "language" ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="mt-10 flex items-center gap-3"
          >
            {stepLabels.map((entry, index) => (
              <div key={entry.label} className="flex items-center gap-2">
                {index > 0 ? (
                  <div className={`h-px w-6 transition-colors duration-300 ${index <= stepIndex ? "bg-[color:var(--accent)]" : "bg-[color:var(--line)]"}`} />
                ) : null}
                <div
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors duration-300 ${
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
          </motion.div>
        ) : null}

        {/* Connector readiness */}
        <ConnectorReadiness
          connectors={connectors}
          currentLocale={currentLocale}
          hasRunnableConnector={hasRunnableConnector}
          onOpenClaudeSettings={onOpenClaudeSettings}
          t={t}
        />

        {/* ELYDORA signature */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mt-12 flex items-center gap-3"
        >
          <div
            className="h-px w-8"
            style={{
              background: "linear-gradient(90deg, var(--accent), transparent)",
            }}
          />
          <span
            className="select-none text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{
              background: "linear-gradient(135deg, var(--accent) 0%, var(--muted) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            by ELYDORA
          </span>
        </motion.div>
      </motion.div>

      {/* Inline keyframe for ambient drift */}
      <style>{`
        @keyframes hero-drift {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(-4%, 3%) scale(1.05); }
        }
      `}</style>
    </div>
  );
}
