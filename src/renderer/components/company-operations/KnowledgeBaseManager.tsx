import { useMemo, useState } from "react";
import { FloppyDisk, Lightbulb, NotePencil, Trash } from "@phosphor-icons/react";
import type { KnowledgeEntryRecord } from "@shared/types";
import { ActionButton, ConfirmDialog, InlineNotice, Input, ListFrame, ListRow, Modal, Select, StatusPill, TextArea } from "../ui";
import { useT } from "../../i18n";
import { knowledgeCategoryOptions, importanceOptions, splitTags, parseTags } from "./helpers";
import { SectionHeader } from "./SectionHeader";

function KnowledgeEditor({ companyId, entry, onSaved }: {
  companyId: string; entry: KnowledgeEntryRecord | null; onSaved: () => Promise<void>;
}) {
  const [topic, setTopic] = useState(entry?.topic ?? "");
  const [category, setCategory] = useState(entry?.category ?? "technical");
  const [importance, setImportance] = useState(entry?.importance ?? "medium");
  const [content, setContent] = useState(entry?.content ?? "");
  const [tags, setTags] = useState(parseTags(entry?.tagsJson ?? "[]"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!topic.trim() || !content.trim()) { setError("Topic and content are required."); return; }
    setSaving(true); setError(null);
    try {
      const result = await window.agentCompany.saveKnowledgeEntry({
        id: entry?.id ?? null, companyId,
        category: category as Parameters<typeof window.agentCompany.saveKnowledgeEntry>[0]["category"],
        topic: topic.trim(), content: content.trim(),
        authorAgentId: entry?.authorAgentId ?? null,
        importance: importance as Parameters<typeof window.agentCompany.saveKnowledgeEntry>[0]["importance"],
        tagsJson: splitTags(tags),
        referencedEntityType: entry?.referencedEntityType ?? null,
        referencedEntityId: entry?.referencedEntityId ?? null,
      });
      if (!result.ok) { setError(result.error.message); return; }
      await onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {error ? <InlineNotice message={error} /> : null}
      <Input label="Topic" value={topic} onChange={setTopic} placeholder="What did the team learn?" />
      <div className="grid gap-4 md:grid-cols-2">
        <Select label="Category" value={category} onChange={(value) => setCategory(value as typeof category)} options={knowledgeCategoryOptions} />
        <Select label="Importance" value={importance} onChange={(value) => setImportance(value as typeof importance)} options={importanceOptions} />
      </div>
      <Input label="Tags" value={tags} onChange={setTags} placeholder="incident, auth, onboarding" />
      <TextArea label="Content" value={content} onChange={setContent} rows={10} placeholder="Enter the knowledge content" />
      <div className="flex justify-end">
        <ActionButton label={saving ? "Saving..." : entry ? "Save entry" : "Create entry"} icon={FloppyDisk} tone="accent" onClick={() => void save()} loading={saving} />
      </div>
    </div>
  );
}

export function KnowledgeBaseManager({ companyId, entries, onRefresh }: {
  companyId: string; entries: KnowledgeEntryRecord[]; onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const activeEntry = useMemo(() => entries.find((entry) => entry.id === editingId) ?? null, [entries, editingId]);

  return (
    <div>
      <SectionHeader title={t("ops.knowledgeBase")} count={entries.length} action={() => setEditingId("__new__")} />
      <ListFrame>
        {entries.map((entry) => (
          <ListRow key={entry.id}>
            <div className="flex items-start justify-between gap-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditingId(entry.id)}>
                <div className="flex items-center gap-2 text-[13px] font-medium text-[color:var(--text)]">
                  <Lightbulb size={15} className="text-[color:var(--accent)]" />
                  <span className="truncate">{entry.topic}</span>
                </div>
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">{entry.category.replaceAll("_", " ")} · {entry.updatedAt.slice(0, 10)}</div>
              </button>
              <div className="flex items-center gap-2">
                <StatusPill status={entry.importance} />
                <button type="button" aria-label="Edit entry" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--text)]" onClick={() => setEditingId(entry.id)}><NotePencil size={14} /></button>
                <button type="button" aria-label="Delete entry" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--danger)]" onClick={() => setDeleteId(entry.id)}><Trash size={14} /></button>
              </div>
            </div>
          </ListRow>
        ))}
      </ListFrame>
      <Modal open={editingId !== null} title={activeEntry ? activeEntry.topic : "New knowledge entry"} onClose={() => setEditingId(null)} width="760px">
        <KnowledgeEditor companyId={companyId} entry={editingId === "__new__" ? null : activeEntry} onSaved={async () => { setEditingId(null); await onRefresh(); }} />
      </Modal>
      <ConfirmDialog open={deleteId !== null} title="Delete knowledge entry" message="This will permanently delete this entry." onCancel={() => setDeleteId(null)} onConfirm={async () => { if (!deleteId) return; const result = await window.agentCompany.deleteKnowledgeEntry({ id: deleteId, companyId }); setDeleteId(null); if (result.ok) await onRefresh(); }} />
    </div>
  );
}
