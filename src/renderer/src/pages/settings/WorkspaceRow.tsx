import { useState, type FormEvent } from "react";
import type { ProjectRecord, WorkspaceRecord } from "../../../../shared/domain";
import { Button, Field, Icon, IconButton, Pill } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import type { SnapshotActions } from "../../app/useSnapshot";
import { t } from "../../i18n/i18n";

/** One workspace with its upkeep: edit its name, folder and project, make it primary, or remove it once nothing open uses it. */
export function WorkspaceRow({ workspace, projects, focused, actions }: { workspace: WorkspaceRecord; projects: ProjectRecord[]; focused: boolean; actions: SnapshotActions }) {
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = (operation: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    return operation().then(after, (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  const orgId = workspace.orgId;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "");
    return act(() => actions.run(() => window.agentCompany.updateWorkspace({
      orgId, workspaceId: workspace.id, name: value("name"), localPath: value("localPath"), projectId: value("projectId") || null,
    })), () => setEditing(false));
  };
  const browse = () => {
    void window.agentCompany.pickDirectory().then((result) => {
      const input = document.querySelector<HTMLInputElement>(`input[data-workspace-path="${workspace.id}"]`);
      if (result.ok && result.data && input) input.value = result.data;
    });
  };
  return (
    <div role="group" aria-label={workspace.name} aria-current={focused ? "true" : undefined} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-soft)", background: focused ? "var(--accent-soft)" : undefined }}>
      <div className="row" style={{ gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div>{workspace.name}</div>
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{workspace.localPath}</div>
        </div>
        {workspace.isPrimary
          ? <Pill tone="violet">{t("Primary")}</Pill>
          : <Button size="small" tone="ghost" onClick={() => act(() => actions.run(() => window.agentCompany.setPrimaryWorkspace({ orgId, workspaceId: workspace.id })))}>{t("Make primary")}</Button>}
        <IconButton icon="edit" label={t("Edit {name}", { name: workspace.name })} onClick={() => setEditing(true)} />
        <Button size="small" tone="ghost" onClick={() => setConfirmRemove(true)}>{t("Remove")}</Button>
      </div>
      {confirmRemove && (
        <div className="row" role="alertdialog" aria-label={t("Remove this workspace?")} style={{ gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: "var(--fs-body)" }}>{t("Remove this workspace? Its folder stays on disk.")}</span>
          <Button size="small" tone="primary" onClick={() => act(() => actions.run(() => window.agentCompany.deleteWorkspace({ orgId, workspaceId: workspace.id })))}>{t("Remove")}</Button>
          <Button size="small" tone="ghost" onClick={() => { setConfirmRemove(false); setError(null); }}>{t("Cancel")}</Button>
        </div>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
      <Dialog title={t("Edit workspace")} open={editing} submitLabel={t("Save")} onClose={() => setEditing(false)} onSubmit={submit}>
        <Field label={t("Name")}><input className="input" name="name" defaultValue={workspace.name} required /></Field>
        <Field label={t("Local path")}>
          <div className="row" style={{ gap: 6 }}>
            <input className="input" name="localPath" data-workspace-path={workspace.id} defaultValue={workspace.localPath} required style={{ flex: 1 }} />
            <Button tone="ghost" onClick={browse}><Icon name="folder" /> {t("Browse")}</Button>
          </div>
        </Field>
        <Field label={t("Project")}>
          <select className="input" name="projectId" defaultValue={workspace.projectId ?? ""}>
            <option value="">{t("None")}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </Field>
        {error && <div className="form-error" role="alert">{error}</div>}
      </Dialog>
    </div>
  );
}
