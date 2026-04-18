import type { ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { APP_LOCALES, LOCALE_LABELS } from "@shared/locale";
import { Eyebrow, Select } from "../../ui";
import { useT } from "../../../i18n";

interface GeneralSectionProps {
  theme: ProfileSnapshot["theme"];
  setTheme: (theme: ProfileSnapshot["theme"]) => void;
  selectedLocale: AppLocale;
  setSelectedLocale: (locale: AppLocale) => void;
  updatesEnabled: boolean;
  setUpdatesEnabled: (enabled: boolean) => void;
  onSaved: () => Promise<void>;
}

/**
 * Theme / language / auto-update preferences. Every control writes to
 * the store immediately via `updateSettings` — there is no global "Save
 * settings" step because the app already persists each field
 * individually as soon as the user changes it.
 */
export function GeneralSection({
  theme,
  setTheme,
  selectedLocale,
  setSelectedLocale,
  updatesEnabled,
  setUpdatesEnabled,
  onSaved,
}: GeneralSectionProps) {
  const t = useT();

  const applyTheme = (next: ProfileSnapshot["theme"]) => {
    setTheme(next);
    const root = document.documentElement;
    root.className = next;
    root.style.colorScheme = next === "system" ? "light dark" : next;
    void window.agentCompany.updateSettings({ theme: next }).then(() => onSaved());
  };

  const applyLocale = (next: AppLocale) => {
    setSelectedLocale(next);
    void window.agentCompany.updateSettings({ locale: next }).then(() => onSaved());
  };

  const applyUpdates = (enabled: boolean) => {
    setUpdatesEnabled(enabled);
    void window.agentCompany.updateSettings({ updatesEnabled: enabled }).then(() => onSaved());
  };

  return (
    <div>
      <Eyebrow className="mb-3">{t("exec.preferences")}</Eyebrow>
      <div className="grid gap-3">
        <Select
          label={t("settings.theme")}
          value={theme}
          onChange={(value) => applyTheme(value as ProfileSnapshot["theme"])}
          options={[
            { value: "system", label: t("settings.system") },
            { value: "dark", label: t("settings.dark") },
            { value: "light", label: t("settings.light") },
          ]}
        />
        <Select
          label={t("settings.language")}
          value={selectedLocale}
          onChange={(value) => applyLocale(value as AppLocale)}
          options={APP_LOCALES.map((locale) => ({ value: locale, label: LOCALE_LABELS[locale] }))}
        />
        <div className="border-t border-border pt-3">
          <label className="flex items-center justify-between text-[13px] text-foreground">
            <div className="flex flex-col">
              <span className="font-medium">{t("exec.enableUpdater")}</span>
              <span className="mt-0.5 text-[11px] text-muted-foreground">{t("settings.updaterHint")}</span>
            </div>
            <input
              type="checkbox"
              checked={updatesEnabled}
              onChange={(event) => applyUpdates(event.target.checked)}
              className="h-4 w-4 accent-[color:var(--primary)]"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
