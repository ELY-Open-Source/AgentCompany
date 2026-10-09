import { useState, type FormEvent } from "react";
import type { OrganizationRecord } from "../../../../shared/domain";
import { Field } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import type { SnapshotActions } from "../../app/useSnapshot";
import { t } from "../../i18n/i18n";
import { WORK_LANGUAGE_NAMES } from "../work/task-helpers";

/** Changes the company's profile and how it runs after onboarding; requests already waiting keep their state. */
export function CompanyDialog({ organization, open, actions, onClose }: { organization: OrganizationRecord; open: boolean; actions: SnapshotActions; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "");
    setError(null);
    actions.run(() => window.agentCompany.updateOrganization({
      orgId: organization.id,
      name: value("name"),
      description: value("description"),
      mission: value("mission"),
      goal: value("goal"),
      executionMode: value("executionMode") === "ai_cofounder" ? "ai_cofounder" : "ai_ceo",
      autoApproveHires: form.get("autoApproveHires") === "on",
      reviewDeliverables: form.get("reviewDeliverables") === "on",
      workLanguage: value("workLanguage") === "zh" ? "zh" : "en",
    })).then(onClose, (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  return (
    <Dialog title={t("Edit company")} open={open} submitLabel={t("Save")} onClose={onClose} onSubmit={submit}>
      <Field label={t("Name")}><input className="input" name="name" defaultValue={organization.name} required /></Field>
      <Field label={t("Description")}><textarea className="input" name="description" defaultValue={organization.description} /></Field>
      <Field label={t("Mission")}><input className="input" name="mission" defaultValue={organization.mission} /></Field>
      <Field label={t("Goal")}><input className="input" name="goal" defaultValue={organization.goal} /></Field>
      <Field label={t("Who runs the work")}>
        <select className="input" name="executionMode" defaultValue={organization.executionMode}>
          <option value="ai_ceo">{t("AI CEO: runs tasks without asking")}</option>
          <option value="ai_cofounder">{t("AI Co-Founder: asks before risky tasks")}</option>
        </select>
      </Field>
      <Field label={t("Agents' working language")}>
        <select className="input" name="workLanguage" defaultValue={organization.workLanguage}>
          <option value="en">{WORK_LANGUAGE_NAMES.en}</option>
          <option value="zh">{WORK_LANGUAGE_NAMES.zh}</option>
        </select>
      </Field>
      <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>{t("Agents write messages, tasks, documents and deliverables in it. The display language does not change it, and a task can set its own.")}</p>
      <label className="checkbox-row"><input type="checkbox" name="autoApproveHires" defaultChecked={organization.autoApproveHires} /> {t("Auto-approve hires")}</label>
      <label className="checkbox-row"><input type="checkbox" name="reviewDeliverables" defaultChecked={organization.reviewDeliverables} /> {t("Review deliverables before they are written")}</label>
      <div style={{ fontSize: 12, color: "var(--text-3)" }}>{t("Changes apply to work from now on; requests already waiting keep their state.")}</div>
      {error && <div className="form-error" role="alert">{error}</div>}
    </Dialog>
  );
}
