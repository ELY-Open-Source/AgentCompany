import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { getStepNumber, TOTAL_STEPS, type OnboardingStepName } from "./OnboardingHero";

interface OnboardingStepProps {
  step: OnboardingStepName;
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}

export function OnboardingStep({ step, eyebrow, title, subtitle, children }: OnboardingStepProps) {
  return (
    <motion.div
      key={step}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="bg-card border border-border shadow-sm w-full rounded-lg p-7"
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {eyebrow} {getStepNumber(step)} / {TOTAL_STEPS}
      </div>
      <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </div>
      {subtitle ? (
        <div className="mb-4 text-[13px] leading-relaxed text-muted-foreground">{subtitle}</div>
      ) : null}
      <div className="mb-6 h-px bg-[color:var(--border)]" />
      {children}
    </motion.div>
  );
}
