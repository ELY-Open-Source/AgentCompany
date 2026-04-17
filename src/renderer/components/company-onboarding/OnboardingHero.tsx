import { motion } from "framer-motion";
import {
  Buildings,
  CheckCircle,
  HardDrive,
  Plugs,
  Rocket,
  SlidersHorizontal,
  Target,
} from "@phosphor-icons/react";
import type { AppLocale } from "@shared/locale";

export type OnboardingStep =
  | "welcome"
  | "nodecheck"
  | "providers"
  | "company"
  | "modelpool"
  | "executionmode"
  | "mission"
  | "launch";

const STEP_LABELS_CONFIG = [
  { key: "onboarding.stepLabelNodeCheck", icon: HardDrive, step: "nodecheck" as const },
  { key: "onboarding.stepLabelProviders", icon: Plugs, step: "providers" as const },
  { key: "onboarding.stepLabelCompany", icon: Buildings, step: "company" as const },
  { key: "onboarding.stepLabelModelPool", icon: SlidersHorizontal, step: "modelpool" as const },
  { key: "onboarding.stepLabelMode", icon: CheckCircle, step: "executionmode" as const },
  { key: "onboarding.stepLabelMission", icon: Target, step: "mission" as const },
  { key: "onboarding.stepLabelLaunch", icon: Rocket, step: "launch" as const },
] as const;

export const STEP_ORDER = [
  "nodecheck",
  "providers",
  "company",
  "modelpool",
  "executionmode",
  "mission",
  "launch",
] as const satisfies readonly OnboardingStep[];

export type OnboardingStepName = (typeof STEP_ORDER)[number];

export const TOTAL_STEPS = STEP_ORDER.length;

export function getStepNumber(step: OnboardingStepName): number {
  return STEP_ORDER.indexOf(step) + 1;
}

interface OnboardingHeroProps {
  step: OnboardingStep;
  currentLocale: AppLocale;
  t: (key: string) => string;
}

export function OnboardingHero({
  step,
  currentLocale: _currentLocale,
  t,
}: OnboardingHeroProps) {
  const stepIndex = (STEP_ORDER as readonly OnboardingStep[]).indexOf(step);

  const stepLabels = STEP_LABELS_CONFIG.map((cfg) => ({
    label: t(cfg.key),
    icon: cfg.icon,
  }));

  return (
    <div className="relative flex min-h-0 items-center justify-center overflow-hidden px-8 py-12 md:px-16">
      {/* Ambient gradient */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 30% 20%, var(--primary) 0%, transparent 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          background: "radial-gradient(ellipse 60% 80% at 70% 80%, var(--primary) 0%, transparent 70%)",
          animation: "hero-drift 12s ease-in-out infinite alternate",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 mx-auto w-full max-w-[min(460px,90vw)]"
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
              background: "linear-gradient(90deg, var(--primary), transparent)",
            }}
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {t("onboarding.subtitle")}
          </span>
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="text-[36px] font-bold leading-[1.05] tracking-[-0.03em] text-foreground md:text-[44px]"
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
          className="mt-4 max-w-[400px] text-[14px] leading-relaxed text-muted-foreground"
        >
          {t("onboarding.description")}
        </motion.p>

        {/* Step progress */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 flex flex-wrap items-center gap-2"
        >
          {stepLabels.map((entry, index) => (
            <div key={entry.label} className="flex items-center gap-1.5">
              {index > 0 ? (
                <div className={`h-px w-4 transition-colors duration-300 ${index <= stepIndex ? "bg-primary" : "bg-[color:var(--border)]"}`} />
              ) : null}
              <div
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors duration-300 ${
                  index < stepIndex
                    ? "bg-success-muted text-success"
                    : index === stepIndex
                      ? "bg-accent text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {index < stepIndex ? <CheckCircle size={12} weight="fill" /> : <entry.icon size={12} />}
                {entry.label}
              </div>
            </div>
          ))}
        </motion.div>

      </motion.div>
    </div>
  );
}
