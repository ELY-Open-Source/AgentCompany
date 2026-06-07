import { useMemo, useState, type FormEvent } from "react";
import { Button, Field, Icon, IconButton, Pill } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import { Dialog } from "../shared/Dialog";
import type { PageProps } from "./types";
import { activeOrgId, formatRelative } from "./types";

const CATEGORIES = ["process", "technical", "product", "market", "legal", "financial", "operational", "general"] as const;
const IMPORTANCES = ["critical", "high", "medium", "low"] as const;

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function KnowledgePage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const entries = useMemo(() => snapshot.knowledgeEntries.filter((e) => e.orgId === orgId), [snapshot.knowledgeEntries, orgId]);
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all" ? entries : entries.filter((e) => e.category === filter);

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createKnowledgeEntry({
      orgId,
      topic: text(form, "topic"),
      category: text(form, "category"),
      content: text(form, "content"),
      importance: text(form, "importance"),
      sourceType: "manual",
      sourceId: null,
    })).then((r) => { if (r) setCreateOpen(false); });
  };

  const remove = (entryId: string) => {
    void actions.run(() => window.agentCompany.deleteKnowledgeEntry({ orgId, entryId }));
  };

  return (
    <div className="page">
      <TopbarActions>
        <select className="button" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter category">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Button tone="primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> Add entry</Button>
      </TopbarActions>
      <h1 className="page-h1">Knowledge Base</h1>
      <p className="page-sub">{entries.length} {entries.length === 1 ? "entry" : "entries"}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {filtered.map((entry) => (
          <article key={entry.id} className="card" style={{ padding: 16 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 540, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.topic}</span>
              <IconButton icon="x" label="Delete" onClick={() => remove(entry.id)} />
            </div>
            <div className="row" style={{ gap: 6, marginBottom: 10 }}>
              <Pill>{entry.category}</Pill>
              <Pill tone={importanceTone(entry.importance)}>{entry.importance}</Pill>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 120, overflow: "hidden" }}>
              {entry.content}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-3)" }}>{formatRelative(entry.updatedAt)}</div>
          </article>
        ))}
      </div>

      <Dialog title="New knowledge entry" open={createOpen} submitLabel="Add" onClose={() => setCreateOpen(false)} onSubmit={create}>
        <Field label="Topic"><input className="input" name="topic" required /></Field>
        <Field label="Category">
          <select className="input" name="category" defaultValue="general">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Importance">
          <select className="input" name="importance" defaultValue="medium">
            {IMPORTANCES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Content"><textarea className="input" name="content" rows={6} required /></Field>
      </Dialog>
    </div>
  );
}

function importanceTone(importance: string): "red" | "amber" | undefined {
  if (importance === "critical") return "red";
  if (importance === "high") return "amber";
  return undefined;
}
