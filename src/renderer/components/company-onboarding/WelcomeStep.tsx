import { motion } from "framer-motion";
import { GlobeSimple, Rocket } from "@phosphor-icons/react";
import type { AppLocale } from "@shared/locale";
import { APP_LOCALES, LOCALE_LABELS } from "@shared/locale";
import { AsciiAnimation } from "./AsciiAnimation";
import { ActionButton } from "../ui";

interface WelcomeStepProps {
  onContinue: () => void;
  currentLocale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
  t: (key: string) => string;
}

export function WelcomeStep({ onContinue, currentLocale, onLocaleChange, t }: WelcomeStepProps) {
  return (
    <div className="relative flex w-full min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-background">
      <AsciiAnimation />

      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-40"
        style={{ background: "linear-gradient(to bottom, var(--background), transparent)" }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-40"
        style={{ background: "linear-gradient(to top, var(--background), transparent)" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-20 flex flex-col items-center text-center px-8"
      >
        <h1 className="text-[48px] font-bold leading-[1.05] tracking-[-0.03em] text-foreground md:text-[64px]">
          AgentCompany
        </h1>

        <p className="mt-4 max-w-[480px] text-[16px] leading-relaxed text-muted-foreground">
          {t("onboarding.welcomeSubtitle")}
        </p>

        <div className="mt-10">
          <ActionButton
            label={t("onboarding.getStarted")}
            icon={Rocket}
            tone="accent"
            onClick={onContinue}
          />
        </div>

        {/* Inline language selector */}
        <div className="mt-6 flex items-center gap-2">
          <GlobeSimple size={14} className="text-muted-foreground" />
          {APP_LOCALES.map((locale, i) => (
            <span key={locale} className="flex items-center gap-2">
              {i > 0 && <span className="text-[12px] text-muted-foreground">/</span>}
              <button
                type="button"
                onClick={() => onLocaleChange(locale)}
                className={`text-[13px] transition ${
                  currentLocale === locale
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {LOCALE_LABELS[locale]}
              </button>
            </span>
          ))}
        </div>

        {/* ELYDORA signature */}
        <div className="mt-12 flex items-center gap-3">
          <div
            className="h-px w-8"
            style={{ background: "linear-gradient(90deg, var(--primary), transparent)" }}
          />
          <span
            className="select-none text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{
              background: "linear-gradient(135deg, var(--primary) 0%, var(--muted-foreground) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            by ELYDORA
          </span>
        </div>
      </motion.div>
    </div>
  );
}
