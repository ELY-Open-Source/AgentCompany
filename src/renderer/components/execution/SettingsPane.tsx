import { useEffect, useState } from "react";
import type { ProfileSnapshot, SecretRecord } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { useLocale } from "../../i18n";
import { GeneralSection } from "./settings-sections/GeneralSection";
import { ExecutionModeSection } from "./settings-sections/ExecutionModeSection";
import { ShortcutsSection } from "./settings-sections/ShortcutsSection";
import { DataSection } from "./settings-sections/DataSection";
import { SecretsSection } from "./settings-sections/SecretsSection";

interface SettingsPaneProps {
  snapshot: ProfileSnapshot;
  secrets: SecretRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
}

/**
 * Settings page orchestrator. Each concern lives in its own ≤200 LOC
 * section under `settings-sections/` so the contents of this file stay
 * scannable instead of hiding 2000-char JSX statements inside one
 * 73-"line" god file.
 *
 * Save model: every preference in GeneralSection writes to
 * `updateSettings` on change, so there is no global "Save" button.
 * DataSection's backup / restore / update-check remain explicit
 * actions because they have side effects beyond a single row of app
 * state.
 */
export function SettingsPane({ snapshot, secrets, companyId, onSaved }: SettingsPaneProps) {
  const currentLocale = useLocale();
  const [theme, setTheme] = useState(snapshot.theme);
  const [selectedLocale, setSelectedLocale] = useState<AppLocale>(snapshot.locale ?? currentLocale);
  const [updatesEnabled, setUpdatesEnabled] = useState(snapshot.updatesEnabled);

  useEffect(() => {
    setTheme(snapshot.theme);
    setUpdatesEnabled(snapshot.updatesEnabled);
    if (snapshot.locale) setSelectedLocale(snapshot.locale);
  }, [snapshot.theme, snapshot.updatesEnabled, snapshot.locale]);

  const company = snapshot.companies.find((entry) => entry.id === companyId) ?? null;

  return (
    <div className="space-y-8">
      <GeneralSection
        snapshot={snapshot}
        theme={theme}
        setTheme={setTheme}
        selectedLocale={selectedLocale}
        setSelectedLocale={setSelectedLocale}
        updatesEnabled={updatesEnabled}
        setUpdatesEnabled={setUpdatesEnabled}
        onSaved={onSaved}
      />
      {company ? <ExecutionModeSection company={company} onSaved={onSaved} /> : null}
      <ShortcutsSection />
      <DataSection snapshot={snapshot} onSaved={onSaved} />
      <SecretsSection secrets={secrets} companyId={companyId} onSaved={onSaved} />
    </div>
  );
}
