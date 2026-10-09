import { DOCUMENT_STATUS_VALUES, documentStatusLabel } from "../../i18n/labels";
import { useEffect, useState, type FormEvent } from "react";
import type { DocumentRecord, TaskRecord } from "../../../../shared/domain";
import type { DocumentVersionRecord } from "../../../../shared/commands";
import type { SnapshotActions } from "../../app/useSnapshot";
import { Dialog } from "../../shared/Dialog";
import { Button, Field, Pill } from "../../shared/ui";
import { formatTime } from "../types";
import { t } from "../../i18n/i18n";

export function DocumentsPanel({
  orgId,
  employeeId,
  documents,
  tasks,
  actions,
}: {
  orgId: string;
  employeeId: string;
  documents: DocumentRecord[];
  tasks: TaskRecord[];
  actions: SnapshotActions;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = documents.find((doc) => doc.id === selectedId) ?? null;
  const [loaded, setLoaded] = useState<{ documentId: string; versions: DocumentVersionRecord[] } | null>(null);
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  const versions = loaded && loaded.documentId === selectedId ? loaded.versions : [];
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentVersion = selected?.version ?? null;
  useEffect(() => {
    if (!selectedId || currentVersion === null) return;
    let cancelled = false;
    void window.agentCompany.listDocumentVersions({ orgId, documentId: selectedId }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setLoaded({ documentId: selectedId, versions: result.data });
      setShownVersion(currentVersion);
    });
    return () => { cancelled = true; };
  }, [orgId, selectedId, currentVersion]);

  const perform = async (operation: () => Promise<unknown>, done: () => void) => {
    setError(null);
    try {
      await operation();
      done();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    return perform(() => actions.run(() => window.agentCompany.updateDocument({
      orgId,
      documentId: selected.id,
      title: String(form.get("title") ?? ""),
      content: String(form.get("content") ?? ""),
      status: String(form.get("status") ?? selected.status),
      reason: String(form.get("reason") ?? ""),
      changedByType: "employee",
      changedById: employeeId,
    })), () => setEditing(false));
  };

  const shown = versions.find((version) => version.version === shownVersion) ?? null;
  const producedBy = selected?.taskId ? tasks.find((task) => task.id === selected.taskId)?.title : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 320px) 1fr", gap: 20, minHeight: 0 }}>
      <div role="list" aria-label={t("Documents")} style={{ display: "grid", gap: 4, alignContent: "start" }}>
        {documents.length === 0 && <p style={{ color: "var(--text-2)" }}>{t("No documents yet.")}</p>}
        {documents.map((doc) => (
          <button
            key={doc.id}
            type="button"
            role="listitem"
            aria-current={doc.id === selectedId}
            className={`nav-item ${doc.id === selectedId ? "active" : ""}`.trim()}
            onClick={() => { setSelectedId(doc.id); setError(null); }}
            style={{ display: "grid", justifyItems: "start", gap: 2 }}
          >
            <span>{doc.title}</span>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>{doc.docType} · v{doc.version} · {formatTime(doc.updatedAt)}</span>
          </button>
        ))}
      </div>
      {selected && (
        <article aria-label={selected.title} style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{shown?.title ?? selected.title}</h2>
            <Pill>{selected.docType}</Pill>
            <Pill tone={selected.status === "approved" ? "green" : undefined}>{documentStatusLabel(shown?.status ?? selected.status)}</Pill>
          </div>
          {producedBy && <p style={{ color: "var(--text-2)", margin: "0 0 8px" }}>{t("Produced by task: {title}", { title: producedBy })}</p>}
          <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <label className="row" style={{ gap: 6 }}>
              <span>{t("Version")}</span>
              <select className="input" value={shownVersion ?? ""} onChange={(event) => setShownVersion(Number(event.target.value))}>
                {versions.map((version) => (
                  <option key={version.version} value={version.version}>
                    v{version.version} — {version.reason} ({formatTime(version.createdAt)})
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={() => setEditing(true)}>{t("Edit")}</Button>
            <Button onClick={() => setConfirmDelete(true)}>{t("Delete")}</Button>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", lineHeight: 1.55 }}>{shown?.content ?? selected.content}</pre>
        </article>
      )}
      {selected && (
        <Dialog title={t("Edit document")} open={editing} submitLabel={t("Save new version")} onClose={() => setEditing(false)} onSubmit={submitEdit}>
          <Field label={t("Title")}><input className="input" name="title" defaultValue={selected.title} required /></Field>
          <Field label={t("Status")}>
            <select className="input" name="status" defaultValue={selected.status}>
              {DOCUMENT_STATUS_VALUES.map((status) => <option key={status} value={status}>{documentStatusLabel(status)}</option>)}
            </select>
          </Field>
          <Field label={t("Content")}><textarea className="input" name="content" defaultValue={selected.content} rows={14} required /></Field>
          <Field label={t("Why this change")}><input className="input" name="reason" required /></Field>
          {error && <div className="form-error" role="alert">{error}</div>}
        </Dialog>
      )}
      {selected && (
        <Dialog
          title={t("Delete document")}
          open={confirmDelete}
          submitLabel={t("Delete")}
          onClose={() => setConfirmDelete(false)}
          onSubmit={(event) => {
            event.preventDefault();
            return perform(() => actions.run(() => window.agentCompany.deleteDocument({ orgId, documentId: selected.id, deletedByEmployeeId: employeeId })), () => {
              setConfirmDelete(false);
              setSelectedId(null);
            });
          }}
        >
          <p>{t("Delete “{title}”? Its {count} versions stay recorded in the history.", { title: selected.title, count: versions.length })}</p>
          {error && <div className="form-error" role="alert">{error}</div>}
        </Dialog>
      )}
    </div>
  );
}
