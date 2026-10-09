import { useState } from "react";
import type { UiLanguage, UiPreferences } from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";
import { Dialog } from "../../shared/Dialog";
import { Button, Field } from "../../shared/ui";
import { t } from "../../i18n/i18n";

const NAMES: Record<UiLanguage, string> = { en: "English", zh: "中文" };

/** The display language is fixed per launch, so a choice waits for a restart the user starts after seeing what it interrupts. */
export function LanguageField({ uiPreferences, actions }: { uiPreferences: UiPreferences; actions: SnapshotActions }) {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = () => {
    setRunning(null);
    setError(null);
    setConfirming(true);
    void window.agentCompany.runningSessionCount().then((result) => {
      if (result.ok) setRunning(result.data);
      else setError(result.error.message);
    });
  };
  const pending = uiPreferences.language !== window.agentCompany.language;
  const restart = () => {
    setError(null);
    void window.agentCompany.relaunchApp().then((result) => { if (!result.ok) setError(result.error.message); });
  };
  return (
    <Field label={t("Language")}>
      <select
        className="input"
        aria-label={t("Language")}
        value={uiPreferences.language}
        onChange={(event) => void actions.run(() => window.agentCompany.setUiPreferences({ language: event.target.value as UiLanguage }))}
      >
        <option value="en">{NAMES.en}</option>
        <option value="zh">{NAMES.zh}</option>
      </select>
      <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("Changes only what you see; agents keep the company's working language.")}</span>
      {pending && (
        <span className="row" style={{ gap: 8, fontSize: 12 }} role="status">
          {t("{language} applies after a restart.", { language: NAMES[uiPreferences.language] })}
          <Button size="small" onClick={confirm}>{t("Restart now")}</Button>
        </span>
      )}
      <Dialog title={t("Restart to switch language?")} open={confirming} submitLabel={t("Restart now")} onClose={() => setConfirming(false)} onSubmit={(event) => { event.preventDefault(); restart(); }}>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6, fontSize: 13 }}>
          <li>{t("Text you typed but have not sent or saved is lost.")}</li>
          <li>{running === null
            ? t("Counting running agent sessions…")
            : t("Running agent sessions: {count}. They stop now; their tasks stay open and start a new session when next queued, by heartbeat or Run, and a chat reply in progress is not sent.", { count: running })}</li>
        </ul>
        {error && <div className="form-error" role="alert">{error}</div>}
      </Dialog>
    </Field>
  );
}
