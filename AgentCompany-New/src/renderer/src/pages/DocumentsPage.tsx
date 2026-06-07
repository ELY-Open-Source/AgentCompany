import { useMemo, useState, type FormEvent } from "react";
import { Avatar, Button, Field, Icon, IconButton, Pill } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import { Dialog } from "../shared/Dialog";
import type { DocumentRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, formatRelative } from "./types";

const DOC_TYPES = ["prd", "spec", "memo", "report", "runbook", "proposal", "policy", "guide", "template", "other"] as const;
const DOC_STATUSES = ["draft", "in_review", "approved", "archived"] as const;

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

export function DocumentsPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const documents = useMemo(() => snapshot.documents.filter((d) => d.orgId === orgId), [snapshot.documents, orgId]);
  const agents = useMemo(() => snapshot.agents.filter((a) => a.orgId === orgId), [snapshot.agents, orgId]);
  const projects = useMemo(() => snapshot.projects.filter((p) => p.orgId === orgId), [snapshot.projects, orgId]);
  const goals = useMemo(() => snapshot.goals.filter((g) => g.orgId === orgId), [snapshot.goals, orgId]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all" ? documents : documents.filter((d) => d.docType === filter);
  const editing = editingId ? documents.find((d) => d.id === editingId) ?? null : null;

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createDocument({
      orgId,
      title: text(form, "title"),
      docType: text(form, "docType"),
      content: text(form, "content"),
      authorAgentId: optional(form, "authorAgentId"),
      reviewerAgentId: null,
      projectId: optional(form, "projectId"),
      goalId: optional(form, "goalId"),
      taskId: null,
    })).then((r) => { if (r) setCreateOpen(false); });
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.updateDocument({
      orgId,
      documentId: editing.id,
      title: text(form, "title"),
      content: text(form, "content"),
      status: text(form, "status"),
    })).then((r) => { if (r) setEditingId(null); });
  };

  const remove = (docId: string) => {
    void actions.run(() => window.agentCompany.deleteDocument({ orgId, documentId: docId }));
    setEditingId(null);
  };

  return (
    <div className="page">
      <TopbarActions>
        <select className="button" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter type">
          <option value="all">All types</option>
          {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button tone="primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> New document</Button>
      </TopbarActions>
      <h1 className="page-h1">Documents</h1>
      <p className="page-sub">{documents.length} {documents.length === 1 ? "document" : "documents"}</p>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 2.5fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 60px" }}>
          <div>Title</div><div>Type</div><div>Status</div><div>Updated</div><div />
        </div>
        {filtered.map((doc, index) => {
          const author = agents.find((a) => a.id === doc.authorAgentId);
          return (
            <div
              key={doc.id}
              role="button"
              tabIndex={0}
              className="table-row clickable"
              onClick={() => setEditingId(doc.id)}
              onKeyDown={(e) => { if (e.key === "Enter") setEditingId(doc.id); }}
              style={{ gridTemplateColumns: "minmax(0, 2.5fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 60px", borderBottom: index === filtered.length - 1 ? "none" : "1px solid var(--border-soft)" }}
            >
              <div className="row" style={{ gap: 8, minWidth: 0 }}>
                {author && <Avatar name={author.name} size="sm" bot />}
                <span style={{ fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title}</span>
              </div>
              <div><Pill>{doc.docType}</Pill></div>
              <div><Pill tone={statusTone(doc.status)}>{doc.status}</Pill></div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>{formatRelative(doc.updatedAt)}</div>
              <div style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                <IconButton icon="x" label="Delete" onClick={() => remove(doc.id)} />
              </div>
            </div>
          );
        })}
      </div>

      <Dialog title="New document" open={createOpen} submitLabel="Create" onClose={() => setCreateOpen(false)} onSubmit={create}>
        <Field label="Title"><input className="input" name="title" required /></Field>
        <Field label="Type">
          <select className="input" name="docType" defaultValue="memo">
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Content"><textarea className="input" name="content" rows={6} required /></Field>
        <Field label="Author">
          <select className="input" name="authorAgentId" defaultValue="">
            <option value="">None</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select className="input" name="projectId" defaultValue="">
            <option value="">None</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Goal">
          <select className="input" name="goalId" defaultValue="">
            <option value="">None</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
      </Dialog>

      {editing && (
        <Dialog key={editing.id} title={editing.title} open submitLabel="Save" onClose={() => setEditingId(null)} onSubmit={save}>
          <Field label="Title"><input className="input" name="title" defaultValue={editing.title} required /></Field>
          <Field label="Status">
            <select className="input" name="status" defaultValue={editing.status}>
              {DOC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Content"><textarea className="input" name="content" rows={10} defaultValue={editing.content} required /></Field>
        </Dialog>
      )}
    </div>
  );
}

function statusTone(status: string): "amber" | "violet" | "green" | undefined {
  if (status === "draft") return undefined;
  if (status === "in_review") return "amber";
  if (status === "approved") return "green";
  return "violet";
}
