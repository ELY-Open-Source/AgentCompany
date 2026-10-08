import { useEffect, useState, type FormEvent } from "react";
import type { AgentRecord, GoalRecord, KnowledgeEntryRecord, ProjectRecord, TaskRecord } from "../../../../shared/domain";
import type { KnowledgeRevisionRecord, KnowledgeScopeType } from "../../../../shared/commands";
import type { SnapshotActions } from "../../app/useSnapshot";
import { Dialog } from "../../shared/Dialog";
import { Button, Field, Pill } from "../../shared/ui";
import { formatTime } from "../types";
import { entryState, type EntryState } from "./library-helpers";
import { t } from "../../i18n/i18n";

const FILTER_LABELS: Record<EntryState, string> = {
  active: t("Active"),
  superseded: t("Superseded"),
  expired: t("Expired"),
};

export function KnowledgePanel({
  orgId,
  employeeId,
  entries,
  scopes,
  actions,
}: {
  orgId: string;
  employeeId: string;
  entries: KnowledgeEntryRecord[];
  scopes: { projects: ProjectRecord[]; goals: GoalRecord[]; tasks: TaskRecord[]; agents: AgentRecord[] };
  actions: SnapshotActions;
}) {
  const now = new Date().toISOString();
  const [filter, setFilter] = useState<EntryState>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ entryId: string; revisions: KnowledgeRevisionRecord[] } | null>(null);
  const [dialog, setDialog] = useState<"new" | "revise" | "delete" | null>(null);
  const [scopeType, setScopeType] = useState<KnowledgeScopeType>("organization");
  const [error, setError] = useState<string | null>(null);
  const visible = entries.filter((entry) => entryState(entry, now) === filter);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const revisions = loaded && loaded.entryId === selectedId ? loaded.revisions : [];

  const selectedUpdatedAt = selected?.updatedAt ?? null;
  useEffect(() => {
    if (!selectedId || selectedUpdatedAt === null) return;
    let cancelled = false;
    void window.agentCompany.listKnowledgeRevisions({ orgId, entryId: selectedId }).then((result) => {
      if (cancelled) return;
      if (result.ok) setLoaded({ entryId: selectedId, revisions: result.data });
      else setError(result.error.message);
    });
    return () => { cancelled = true; };
  }, [orgId, selectedId, selectedUpdatedAt]);

  const perform = (operation: () => Promise<unknown>, done: () => void) => {
    setError(null);
    void operation().then(done, (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  };
  const text = (form: FormData, key: string) => String(form.get(key) ?? "");

  const submitNew = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const validUntil = text(form, "validUntil");
    perform(() => actions.run(() => window.agentCompany.createKnowledgeEntry({
      orgId,
      topic: text(form, "topic"),
      category: text(form, "category"),
      content: text(form, "content"),
      importance: text(form, "importance"),
      sourceType: "employee",
      sourceId: employeeId,
      scopeType,
      scopeId: scopeType === "organization" ? null : text(form, "scopeId"),
      validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      supersedesId: null,
    })), () => setDialog(null));
  };

  const submitRevise = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    perform(() => actions.run(() => window.agentCompany.updateKnowledgeEntry({
      orgId,
      entryId: selected.id,
      topic: text(form, "topic"),
      category: text(form, "category"),
      content: text(form, "content"),
      importance: text(form, "importance"),
      reason: text(form, "reason"),
      changedByType: "employee",
      changedById: employeeId,
    })), () => setDialog(null));
  };

  const scopeOptions: Record<Exclude<KnowledgeScopeType, "organization">, Array<{ id: string; label: string }>> = {
    project: scopes.projects.map((item) => ({ id: item.id, label: item.name })),
    goal: scopes.goals.map((item) => ({ id: item.id, label: item.title })),
    task: scopes.tasks.map((item) => ({ id: item.id, label: item.title })),
    agent: scopes.agents.map((item) => ({ id: item.id, label: item.name })),
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 340px) 1fr", gap: 20, minHeight: 0 }}>
      <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
        <div className="row" style={{ gap: 6 }}>
          {(["active", "superseded", "expired"] as const).map((state) => (
            <Button key={state} size="small" tone={filter === state ? "primary" : undefined} onClick={() => setFilter(state)}>
              {FILTER_LABELS[state]}
            </Button>
          ))}
          <Button size="small" onClick={() => { setScopeType("organization"); setDialog("new"); }}>{t("New")}</Button>
        </div>
        <div role="list" aria-label={t("Knowledge")} style={{ display: "grid", gap: 4 }}>
          {visible.length === 0 && <p style={{ color: "var(--text-2)" }}>{t("Nothing here.")}</p>}
          {visible.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="listitem"
              aria-current={entry.id === selectedId}
              className={`nav-item ${entry.id === selectedId ? "active" : ""}`.trim()}
              onClick={() => { setSelectedId(entry.id); setError(null); }}
              style={{ display: "grid", justifyItems: "start", gap: 2 }}
            >
              <span>{entry.topic}</span>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{entry.category} · {entry.scopeType} · {entry.importance}</span>
            </button>
          ))}
        </div>
      </div>
      {selected && (
        <article aria-label={selected.topic} style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{selected.topic}</h2>
            <Pill>{selected.category}</Pill>
            <Pill>{selected.scopeType}</Pill>
            <Pill tone={entryState(selected, now) === "active" ? "green" : "amber"}>{entryState(selected, now)}</Pill>
          </div>
          {selected.validUntil && <p style={{ color: "var(--text-2)", margin: "0 0 8px" }}>{t("Valid until {time}", { time: formatTime(selected.validUntil) })}</p>}
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <Button onClick={() => setDialog("revise")}>{t("Revise")}</Button>
            <Button onClick={() => setDialog("delete")}>{t("Delete")}</Button>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{selected.content}</p>
          <div className="section-label" style={{ margin: "18px 0 8px" }}>{t("History")}</div>
          <ol style={{ display: "grid", gap: 10, paddingLeft: 18 }}>
            {revisions.map((revision) => (
              <li key={revision.revision}>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                  r{revision.revision} · {formatTime(revision.createdAt)} · {revision.changedByType} · {revision.reason}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{revision.content}</div>
              </li>
            ))}
          </ol>
        </article>
      )}
      <Dialog title={t("New knowledge")} open={dialog === "new"} submitLabel={t("Save")} onClose={() => setDialog(null)} onSubmit={submitNew}>
        <Field label={t("Topic")}><input className="input" name="topic" required /></Field>
        <Field label={t("Category")}><input className="input" name="category" placeholder="decision" required /></Field>
        <Field label={t("Content")}><textarea className="input" name="content" rows={6} required /></Field>
        <Field label={t("Importance")}>
          <select className="input" name="importance" defaultValue="normal">
            {["low", "normal", "high"].map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </Field>
        <Field label={t("Applies to")}>
          <select className="input" value={scopeType} onChange={(event) => setScopeType(event.target.value as KnowledgeScopeType)}>
            {(["organization", "project", "goal", "task", "agent"] as const).map((scope) => <option key={scope} value={scope}>{scope}</option>)}
          </select>
        </Field>
        {scopeType !== "organization" && (
          <Field label={t("Which one")}>
            <select className="input" name="scopeId" required>
              {scopeOptions[scopeType].map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </Field>
        )}
        <Field label={t("Valid until (optional)")}><input className="input" name="validUntil" type="datetime-local" /></Field>
        {error && <div className="form-error" role="alert">{error}</div>}
      </Dialog>
      {selected && (
        <Dialog title={t("Revise knowledge")} open={dialog === "revise"} submitLabel={t("Save revision")} onClose={() => setDialog(null)} onSubmit={submitRevise}>
          <Field label={t("Topic")}><input className="input" name="topic" defaultValue={selected.topic} required /></Field>
          <Field label={t("Category")}><input className="input" name="category" defaultValue={selected.category} required /></Field>
          <Field label={t("Content")}><textarea className="input" name="content" defaultValue={selected.content} rows={6} required /></Field>
          <Field label={t("Importance")}>
            <select className="input" name="importance" defaultValue={selected.importance}>
              {["low", "normal", "high"].map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </Field>
          <Field label={t("Why this change")}><input className="input" name="reason" required /></Field>
          {error && <div className="form-error" role="alert">{error}</div>}
        </Dialog>
      )}
      {selected && (
        <Dialog
          title={t("Delete knowledge")}
          open={dialog === "delete"}
          submitLabel={t("Delete")}
          onClose={() => setDialog(null)}
          onSubmit={(event) => {
            event.preventDefault();
            perform(() => actions.run(() => window.agentCompany.deleteKnowledgeEntry({ orgId, entryId: selected.id, deletedByEmployeeId: employeeId })), () => {
              setDialog(null);
              setSelectedId(null);
            });
          }}
        >
          <p>{t("Delete “{title}”? Agents will stop seeing it; its revision history stays recorded.", { title: selected.topic })}</p>
          {error && <div className="form-error" role="alert">{error}</div>}
        </Dialog>
      )}
    </div>
  );
}
