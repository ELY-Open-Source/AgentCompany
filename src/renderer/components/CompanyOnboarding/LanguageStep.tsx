import { motion } from "framer-motion";
import { CheckCircle, GlobeSimple } from "@phosphor-icons/react";
import type { AppLocale } from "@shared/locale";
import { APP_LOCALES, LOCALE_LABELS } from "@shared/locale";
import { ActionButton } from "../ui";

interface LanguageStepProps {
  currentLocale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
  onContinue: () => void;
  t: (key: string) => string;
}

export function LanguageStep({
  currentLocale,
  onLocaleChange,
  onContinue,
  t,
}: LanguageStepProps) {
  return (
    <motion.div
      key="language"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="bg-card border border-border shadow-sm w-full rounded-lg p-7"
    >
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <GlobeSimple size={12} />
        {t("onboarding.languageSelection")} / Language
      </div>
      <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-foreground">
        {t("onboarding.selectLanguage")} / Select Language
      </div>
      <div className="mb-6 h-px bg-[color:var(--border)]" />

      <div className="space-y-2.5">
        {APP_LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            onClick={() => onLocaleChange(locale)}
            className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3.5 text-left transition ${
              currentLocale === locale
                ? "border-[color:var(--primary)] bg-accent"
                : "border-border bg-muted hover:border-[color:var(--muted-foreground)]"
            }`}
          >
            <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
              currentLocale === locale
                ? "border-[color:var(--primary)] bg-primary"
                : "border-border"
            }`}>
              {currentLocale === locale ? <CheckCircle size={14} weight="fill" className="text-primary-foreground" /> : null}
            </div>
            <span className={`text-[14px] font-medium ${
              currentLocale === locale ? "text-foreground" : "text-muted-foreground"
            }`}>
              {LOCALE_LABELS[locale]}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-8 flex items-center justify-end">
        <ActionButton
          label={t("onboarding.continue")}
          onClick={onContinue}
          icon={GlobeSimple}
          tone="accent"
        />
      </div>
    </motion.div>
  );
}
