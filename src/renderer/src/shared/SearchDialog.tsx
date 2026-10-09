import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { AppSnapshot, SearchEntityType, SearchResultRecord } from "../../../shared/domain";
import { SEARCH_ENTITY_TYPES } from "../../../shared/domain";
import type { RouteId } from "./routes";
import type { Focus } from "../pages/types";
import { Button, Icon, Pill } from "./ui";
import { t } from "../i18n/i18n";

type SearchFilter = "all" | SearchEntityType;

const LABELS: Record<SearchEntityType, string> = {
  employee: t("Employee"),
  agent: t("Agent"),
  task: t("Task"),
  goal: t("Goal"),
  project: t("Project"),
  workspace: t("Workspace"),
  approval: t("Approval"),
  chat_space: t("Space"),
  chat_message: t("Message"),
  file: t("File"),
  provider: t("Provider"),
  document: t("Document"),
  knowledge: t("Knowledge"),
};

export function SearchDialog({
  snapshot,
  open,
  onClose,
  onNavigate,
}: {
  snapshot: AppSnapshot;
  open: boolean;
  onClose: () => void;
  onNavigate: (route: RouteId, focus: Focus) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [results, setResults] = useState<SearchResultRecord[]>([]);
  const orgId = snapshot.activeOrgId;
  const employee = useMemo(() => snapshot.employees.find((item) => item.orgId === orgId), [snapshot.employees, orgId]);
  const canSearch = Boolean(orgId && employee && query.trim().length >= 2);
  const visibleResults = canSearch ? results : [];

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!orgId || !employee || trimmed.length < 2) return;
    const timeout = window.setTimeout(() => {
      void window.agentCompany.search({
        orgId,
        employeeId: employee.id,
        query: trimmed,
        entityTypes: filter === "all" ? undefined : [filter],
        limit: 12,
      }).then((result) => {
        if (!result.ok) throw new Error(result.error.message);
        setResults(result.data);
      });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [employee, filter, open, orgId, query]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, open]);

  if (!open) return null;
  const openResult = (result: SearchResultRecord) => {
    const target = targetFor(result);
    onNavigate(target.route, target.focus);
    onClose();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const first = visibleResults[0];
    if (!first) return;
    openResult(first);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Search")}
      style={overlayStyle}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <form onSubmit={submit} style={panelStyle}>
        <div className="row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-soft)" }}>
          <Icon name="search" size={14} color="var(--text-3)" />
          <input
            autoFocus
            aria-label={t("Search query")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={inputStyle}
          />
          <select
            aria-label={t("Search filter")}
            className="input"
            value={filter}
            onChange={(event) => setFilter(event.target.value as SearchFilter)}
            style={{ width: 150, height: 28, padding: "2px 8px", fontSize: 12 }}
          >
            <option value="all">{t("All")}</option>
            {SEARCH_ENTITY_TYPES.map((type) => <option key={type} value={type}>{LABELS[type]}</option>)}
          </select>
          <Button size="small" onClick={onClose}>{t("Close")}</Button>
        </div>
        <div style={{ maxHeight: 420, overflow: "auto", padding: 8 }}>
          {visibleResults.map((result) => (
            <button
              key={`${result.entityType}:${result.entityId}`}
              type="button"
              onClick={() => openResult(result)}
              style={rowStyle}
            >
              <Pill>{LABELS[result.entityType]}</Pill>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.preview}</div>
              </div>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{result.facets.type}</span>
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

/** The page and the object on it that a hit opens. */
function targetFor(result: SearchResultRecord): { route: RouteId; focus: Focus } {
  const id = result.entityId;
  switch (result.entityType) {
    case "employee": return { route: "team", focus: { kind: "employee", id } };
    case "agent": return { route: "team", focus: { kind: "agent", id } };
    case "task": return { route: "work", focus: { kind: "task", id } };
    case "goal": return { route: "work", focus: { kind: "goal", id } };
    case "project": return { route: "work", focus: { kind: "project", id } };
    case "workspace": return { route: "settings", focus: { kind: "workspace", id } };
    case "approval": return { route: "approvals", focus: { kind: "approval", id } };
    case "chat_space": return { route: "chat", focus: { kind: "space", id } };
    case "chat_message": return { route: "chat", focus: { kind: "message", id, spaceId: requireFacet(result, "space"), threadId: requireFacet(result, "thread") } };
    case "file": return { route: "files", focus: { kind: "file", id } };
    case "provider": return { route: "settings", focus: { kind: "provider", id } };
    case "document": return { route: "library", focus: { kind: "document", id } };
    case "knowledge": return { route: "library", focus: { kind: "knowledge", id } };
  }
}

function requireFacet(result: SearchResultRecord, name: string): string {
  const value = result.facets[name];
  if (!value) throw new Error(`Search result ${result.entityId} has no ${name}.`);
  return value;
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
  background: "rgba(9, 9, 11, 0.16)",
  display: "grid",
  placeItems: "start center",
  paddingTop: "12vh",
} satisfies CSSProperties;

const panelStyle = {
  width: "min(680px, calc(100vw - 32px))",
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "var(--panel)",
  boxShadow: "var(--shadow-md)",
  overflow: "hidden",
} satisfies CSSProperties;

const inputStyle = {
  flex: 1,
  minWidth: 0,
  border: 0,
  outline: "none",
  background: "transparent",
  fontSize: 14,
} satisfies CSSProperties;

const rowStyle = {
  width: "100%",
  border: 0,
  borderRadius: 8,
  background: "transparent",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 10px",
  textAlign: "left",
} satisfies CSSProperties;
