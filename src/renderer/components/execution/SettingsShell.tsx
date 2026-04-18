import { useState, useMemo } from "react";
import type { ProfileSnapshot, SecretRecord } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { useEffect } from "react";
import { useLocale, useT } from "../../i18n";
import { GeneralSection } from "./settings-sections/GeneralSection";
import { ExecutionModeSection } from "./settings-sections/ExecutionModeSection";
import { ShortcutsSection } from "./settings-sections/ShortcutsSection";
import { DataSection } from "./settings-sections/DataSection";
import { SecretsSection } from "./settings-sections/SecretsSection";
import { ProvidersPanel } from "../settings/providers/ProvidersPanel";

type SettingsTab = "general" | "mode" | "providers" | "shortcuts" | "data" | "secrets";

interface SettingsShellProps {
  snapshot: ProfileSnapshot;
  secrets: SecretRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
}

/**
 * Settings page with top-row tab navigation. Replaces the previous
 * single-scroll layout that stacked seven unrelated concerns
 * (preferences, execution mode, providers, keyboard reference, data
 * ops, secrets) in one column forcing users to scroll past everything
 * they didn't need.
 *
 * Tabs live as local state — settings are transient; there is no
 * benefit to persisting the active tab across company switches or
 * app restarts. Default is "general" because first-time users most
 * often land here for theme / language.
 */
export function SettingsShell({ snapshot, secrets, companyId, onSaved }: SettingsShellProps) {
  const t = useT();
  const currentLocale = useLocale();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [theme, setTheme] = useState(snapshot.theme);
  const [selectedLocale, setSelectedLocale] = useState<AppLocale>(snapshot.locale ?? currentLocale);
  const [updatesEnabled, setUpdatesEnabled] = useState(snapshot.updatesEnabled);

  useEffect(() => {
    setTheme(snapshot.theme);
    setUpdatesEnabled(snapshot.updatesEnabled);
    if (snapshot.locale) setSelectedLocale(snapshot.locale);
  }, [snapshot.theme, snapshot.updatesEnabled, snapshot.locale]);

  const company = useMemo(
    () => snapshot.companies.find((entry) => entry.id === companyId) ?? null,
    [snapshot.companies, companyId],
  );

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: "general", label: t("settings.tabs.general") },
    { id: "mode", label: t("settings.tabs.mode") },
    { id: "providers", label: t("settings.tabs.providers") },
    { id: "shortcuts", label: t("settings.tabs.shortcuts") },
    { id: "data", label: t("settings.tabs.data") },
    { id: "secrets", label: t("settings.tabs.secrets") },
  ];

  return (
    <div className="space-y-6">
      <nav
        role="tablist"
        aria-label={t("settings.tabsAria")}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-4 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 bottom-[-1px] h-[2px] bg-primary"
                />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div>
        {activeTab === "general" ? (
          <GeneralSection
            theme={theme}
            setTheme={setTheme}
            selectedLocale={selectedLocale}
            setSelectedLocale={setSelectedLocale}
            updatesEnabled={updatesEnabled}
            setUpdatesEnabled={setUpdatesEnabled}
            onSaved={onSaved}
          />
        ) : null}
        {activeTab === "mode" && company ? (
          <ExecutionModeSection company={company} onSaved={onSaved} />
        ) : null}
        {activeTab === "providers" ? <ProvidersPanel /> : null}
        {activeTab === "shortcuts" ? <ShortcutsSection /> : null}
        {activeTab === "data" ? <DataSection snapshot={snapshot} onSaved={onSaved} /> : null}
        {activeTab === "secrets" ? (
          <SecretsSection secrets={secrets} companyId={companyId} onSaved={onSaved} />
        ) : null}
      </div>
    </div>
  );
}
