import { useState, type FormEvent } from "react";
import type {
  OrganizationRecord,
  ProjectRecord,
  UiLanguage,
  UiPreferences,
  UiTheme,
  WorkspaceRecord,
} from "../../../../shared/domain";
import { Button, Field, Icon, Pill } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import { t } from "../../i18n/i18n";
import type { SnapshotActions } from "../../app/useSnapshot";

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

export function WorkspacePanel({
  organization,
  workspaces,
  projects,
  orgId,
  uiPreferences,
  actions,
}: {
  organization: OrganizationRecord;
  workspaces: WorkspaceRecord[];
  projects: ProjectRecord[];
  orgId: string;
  uiPreferences: UiPreferences;
  actions: SnapshotActions;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  const chooseDirectory = async (form: HTMLFormElement) => {
    const result = await window.agentCompany.pickDirectory();
    if (result.ok && result.data) {
      const input = form.elements.namedItem("localPath") as HTMLInputElement | null;
      if (input) input.value = result.data;
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createWorkspace({
      orgId,
      name: text(form, "name"),
      localPath: text(form, "localPath"),
      projectId: optional(form, "projectId"),
    })).then((result) => { if (result) setCreateOpen(false); });
  };

  return (
    <div className="page">
      <h1 className="page-h1">{t("General")}</h1>

      <div className="row" style={{ gap: 8, margin: "16px 0 24px" }}>
        <Pill tone="violet" dot>{organization.executionMode === "ai_ceo" ? t("AI CEO") : t("AI Co-Founder")}</Pill>
        {organization.autoApproveHires ? <Pill tone="green" dot>{t("Auto-approve hires")}</Pill> : <Pill>{t("Hires require approval")}</Pill>}
        {organization.reviewDeliverables ? <Pill tone="amber" dot>{t("Reviews deliverables")}</Pill> : <Pill>{t("Ships without review")}</Pill>}
      </div>

      <div style={{ marginBottom: 28 }}>
        <KeyValue label={t("Name")} value={organization.name} />
        <KeyValue label={t("Mission")} value={organization.mission || "—"} />
        <KeyValue label={t("Goal")} value={organization.goal || "—"} />
        <KeyValue label={t("Description")} value={organization.description || "—"} />
      </div>

      <div className="section-label" style={{ marginBottom: 8 }}>{t("Appearance")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 240px))", gap: 12, marginBottom: 28 }}>
        <Field label={t("Theme")}>
          <select
            className="input"
            aria-label={t("Theme")}
            value={uiPreferences.theme}
            onChange={(event) =>
              void actions.run(() => window.agentCompany.setUiPreferences({ theme: event.target.value as UiTheme }))
            }
          >
            <option value="system">{t("System")}</option>
            <option value="light">{t("Light")}</option>
            <option value="dark">{t("Dark")}</option>
          </select>
        </Field>
        <Field label={t("Language")}>
          <select
            className="input"
            aria-label={t("Language")}
            value={uiPreferences.language}
            onChange={(event) =>
              void actions.run(() => window.agentCompany.setUiPreferences({ language: event.target.value as UiLanguage }))
            }
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </Field>
      </div>

      <div className="row reveal-row" style={{ marginBottom: 8 }}>
        <div className="section-label">{t("Workspaces")}</div>
        <span className="reveal" style={{ marginLeft: "auto" }}>
          <Button tone="ghost" onClick={() => setCreateOpen(true)}><Icon name="plus" size={16} /> {t("Add")}</Button>
        </span>
      </div>
      {workspaces.map((workspace) => (
        <div key={workspace.id} className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 540 }}>{workspace.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{workspace.localPath}</div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            {workspace.isPrimary && <Pill tone="violet">{t("Primary")}</Pill>}
          </div>
        </div>
      ))}

      <Dialog title={t("Add workspace")} open={createOpen} submitLabel={t("Create")} onClose={() => setCreateOpen(false)} onSubmit={submit}>
        <Field label={t("Name")}><input className="input" name="name" required /></Field>
        <Field label={t("Local path")}>
          <div className="row" style={{ gap: 6 }}>
            <input className="input" name="localPath" required style={{ flex: 1 }} />
            <Button tone="ghost" onClick={() => {
              const form = document.querySelector<HTMLFormElement>("form:has([name='localPath'])");
              if (form) void chooseDirectory(form);
            }}>
              <Icon name="folder" size={16} /> {t("Browse")}
            </Button>
          </div>
        </Field>
        <Field label={t("Project")}>
          <select className="input" name="projectId" defaultValue="">
            <option value="">{t("None")}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </Dialog>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--border-soft)" }}>
      <span style={{ color: "var(--text-3)", width: 120, flexShrink: 0, fontSize: 12 }}>{label}</span>
      <span style={{ flex: 1, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}
