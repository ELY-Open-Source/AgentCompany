import { useMemo, useState } from "react";
import { FileText, FloppyDisk, NotePencil, Trash } from "@phosphor-icons/react";
import type { AgentRecord, DocumentRecord, GoalRecord, ProjectRecord } from "@shared/types";
import { ActionButton, ConfirmDialog, InlineNotice, Input, ListFrame, ListRow, Modal, Select, StatusPill, TextArea } from "../ui";
import { useT } from "../../i18n";
import { documentTypeOptions, documentStatusOptions, splitTags, parseTags } from "./helpers";
import { SectionHeader } from "./SectionHeader";

function DocumentEditor({ companyId, agents, projects, goals, document, onSaved }: {
  companyId: string; agents: AgentRecord[]; projects: ProjectRecord[]; goals: GoalRecord[];
  document: DocumentRecord | null; onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(document?.title ?? "");
  const [type, setType] = useState(document?.type ?? "technical_spec");
  const [content, setContent] = useState(document?.content ?? "");
  const [status, setStatus] = useState(document?.status ?? "draft");
  const [reviewerAgentId, setReviewerAgentId] = useState(document?.reviewerAgentId ?? "");
  const [projectId, setProjectId] = useState(document?.projectId ?? "");
  const [goalId, setGoalId] = useState(document?.goalId ?? "");
  const [tags, setTags] = useState(parseTags(document?.tagsJson ?? "[]"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) { setError("Document title is required."); return; }
    setSaving(true); setError(null);
    try {
      const result = await window.agentCompany.saveDocument({
        id: document?.id ?? null, companyId,
        type: type as Parameters<typeof window.agentCompany.saveDocument>[0]["type"],
        title: title.trim(), content,
        authorAgentId: document?.authorAgentId ?? null, reviewerAgentId: reviewerAgentId || null,
        projectId: projectId || null, goalId: goalId || null,
        parentDocId: document?.parentDocId ?? null, version: document?.version ?? 1,
        status: status as Parameters<typeof window.agentCompany.saveDocument>[0]["status"],
        tagsJson: splitTags(tags),
      });
      if (!result.ok) { setError(result.error.message); return; }
      await onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {error ? <InlineNotice message={error} /> : null}
      <Input label="Title" value={title} onChange={setTitle} placeholder="Architecture review summary" />
      <div className="grid gap-4 md:grid-cols-2">
        <Select label="Type" value={type} onChange={(value) => setType(value as typeof type)} options={documentTypeOptions} />
        <Select label="Status" value={status} onChange={(value) => setStatus(value as typeof status)} options={documentStatusOptions} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Select label="Reviewer" value={reviewerAgentId} onChange={setReviewerAgentId} options={[{ value: "", label: "None" }, ...agents.map((agent) => ({ value: agent.id, label: `${agent.name} (${agent.role})` }))]} />
        <Input label="Tags" value={tags} onChange={setTags} placeholder="architecture, security, release" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Select label="Project" value={projectId} onChange={setProjectId} options={[{ value: "", label: "None" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} />
        <Select label="Goal" value={goalId} onChange={setGoalId} options={[{ value: "", label: "None" }, ...goals.map((goal) => ({ value: goal.id, label: goal.title }))]} />
      </div>
      <TextArea label="Content" value={content} onChange={setContent} rows={12} placeholder="Write the document content here." />
      <div className="flex justify-end">
        <ActionButton label={saving ? "Saving..." : document ? "Save document" : "Create document"} icon={FloppyDisk} tone="accent" onClick={() => void save()} loading={saving} />
      </div>
    </div>
  );
}

export function DocumentCenter({ companyId, documents, agents, projects, goals, onRefresh }: {
  companyId: string; documents: DocumentRecord[]; agents: AgentRecord[]; projects: ProjectRecord[];
  goals: GoalRecord[]; onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const activeDocument = useMemo(() => documents.find((document) => document.id === editingId) ?? null, [documents, editingId]);

  return (
    <div>
      <SectionHeader title={t("ops.documentCenter")} count={documents.length} action={() => setEditingId("__new__")} />
      <ListFrame>
        {documents.map((document) => (
          <ListRow key={document.id}>
            <div className="flex items-start justify-between gap-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditingId(document.id)}>
                <div className="flex items-center gap-2 text-[13px] font-medium text-[color:var(--text)]">
                  <FileText size={15} className="text-[color:var(--accent)]" />
                  <span className="truncate">{document.title}</span>
                </div>
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">{document.type.replaceAll("_", " ")} · v{document.version} · {document.updatedAt.slice(0, 10)}</div>
              </button>
              <div className="flex items-center gap-2">
                <StatusPill status={document.status} />
                <button type="button" aria-label="Edit document" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--text)]" onClick={() => setEditingId(document.id)}><NotePencil size={14} /></button>
                <button type="button" aria-label="Delete document" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--danger)]" onClick={() => setDeleteId(document.id)}><Trash size={14} /></button>
              </div>
            </div>
          </ListRow>
        ))}
      </ListFrame>
      <Modal open={editingId !== null} title={activeDocument ? activeDocument.title : "New document"} onClose={() => setEditingId(null)} width="760px">
        <DocumentEditor companyId={companyId} agents={agents} projects={projects} goals={goals} document={editingId === "__new__" ? null : activeDocument} onSaved={async () => { setEditingId(null); await onRefresh(); }} />
      </Modal>
      <ConfirmDialog open={deleteId !== null} title="Delete document" message="This removes the document from the company knowledge surface." onCancel={() => setDeleteId(null)} onConfirm={async () => { if (!deleteId) return; const result = await window.agentCompany.deleteDocument({ id: deleteId, companyId }); setDeleteId(null); if (result.ok) await onRefresh(); }} />
    </div>
  );
}
