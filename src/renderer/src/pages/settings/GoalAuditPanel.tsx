import { useState, type FormEvent } from "react";
import type { OrganizationRecord, ProviderRecord } from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";
import { Button, Field } from "../../shared/ui";
import { t } from "../../i18n/i18n";

/** The model that audits goal completion; it must differ from the executor's so the two do not share one model's blind spots. */
export function GoalAuditPanel({ organization, providers, actions }: { organization: OrganizationRecord; providers: ProviderRecord[]; actions: SnapshotActions }) {
  const [providerId, setProviderId] = useState(organization.auditProviderId ?? "");
  const [modelId, setModelId] = useState(organization.auditModelId ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    void actions.run(() => window.agentCompany.setGoalAuditor({ orgId: organization.id, providerId, modelId }))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  return (
    <section>
      <div className="section-label" style={{ marginBottom: 6 }}>{t("Goal audit")}</div>
      <p style={{ color: "var(--text-2)", fontSize: 13, margin: "0 0 12px" }}>
        {t("An independent model checks every goal before it closes. Pick one your agents do not use, ideally from another provider.")}
      </p>
      {!organization.auditModelId && (
        <p style={{ color: "var(--red)", fontSize: 13, margin: "0 0 12px" }}>{t("No auditor is set, so goals cannot be closed yet.")}</p>
      )}
      <form className="row" style={{ gap: 10, alignItems: "flex-end" }} onSubmit={save}>
        <Field label={t("Provider")}>
          <select className="input" value={providerId} onChange={(event) => setProviderId(event.target.value)} required>
            <option value="" disabled>{t("Choose a provider")}</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </Field>
        <Field label={t("Model")}>
          <input className="input" value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="claude-opus-5-5" required />
        </Field>
        <Button type="submit">{t("Save")}</Button>
      </form>
      {error && <p style={{ color: "var(--red)", fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
    </section>
  );
}
