import { ScopeNote } from "./ScopeNote";
import { useState, type FormEvent } from "react";
import type { IntegrationKeyName, IntegrationKeyStatus } from "../../../../shared/commands";
import { Button, Field, Pill } from "../../shared/ui";
import { t } from "../../i18n/i18n";
import type { SnapshotActions } from "../../app/useSnapshot";

const KEY_COPY: Record<IntegrationKeyName, { label: string; hint: string; placeholder: string }> = {
  composio: {
    label: t("Composio API key"),
    hint: t("Powers the Connectors page and agent connector tools. Create one at platform.composio.dev."),
    placeholder: "ak_…",
  },
  logo_dev: {
    label: t("logo.dev publishable key"),
    hint: t("Shows brand logos for connectors. Create one at logo.dev."),
    placeholder: "pk_…",
  },
};

export function IntegrationKeysPanel({ keys, companyName, actions }: { keys: IntegrationKeyStatus[]; companyName: string; actions: SnapshotActions }) {
  return (
    <div className="page">
      <h1 className="page-h1">{t("Integrations")}</h1>
      <ScopeNote scope="app" company={companyName} />
      <p style={{ margin: "0 0 24px", color: "var(--text-2)" }}>
        {t("Keys are stored on this device, encrypted by the operating system, and shared by every company.")}
      </p>
      {keys.map((status) => <IntegrationKeyRow key={status.name} status={status} actions={actions} />)}
    </div>
  );
}

export function IntegrationKeyRow({ status, actions }: { status: IntegrationKeyStatus; actions: SnapshotActions }) {
  const copy = KEY_COPY[status.name];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const perform = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = String(new FormData(form).get("value") ?? "");
    void perform(async () => {
      await actions.run(() => window.agentCompany.setIntegrationKey({ name: status.name, value }));
      form.reset();
    });
  };

  return (
    <form onSubmit={save} style={{ marginBottom: 24 }}>
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        <span className="section-label">{copy.label}</span>
        {status.configured ? <Pill tone="green" dot>{t("Saved")}</Pill> : <Pill>{t("Not set")}</Pill>}
      </div>
      <p style={{ margin: "0 0 8px", color: "var(--text-2)" }}>{copy.hint}</p>
      <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1, maxWidth: 420 }}>
          <Field label={status.configured ? t("Replace key") : t("Key")}>
            <input className="input" name="value" type="password" autoComplete="off" placeholder={copy.placeholder} required />
          </Field>
        </div>
        <Button type="submit" tone="primary" disabled={busy}>{t("Save")}</Button>
        {status.configured && (
          <Button
            disabled={busy}
            onClick={() => void perform(() => actions.run(() => window.agentCompany.clearIntegrationKey({ name: status.name })))}
          >
            {t("Remove")}
          </Button>
        )}
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
    </form>
  );
}
