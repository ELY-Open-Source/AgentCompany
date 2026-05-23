import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { AppSnapshot, SearchEntityType, SearchResultRecord } from "../../../shared/domain";
import { SEARCH_ENTITY_TYPES } from "../../../shared/domain";
import type { RouteId } from "./Shell";
import { Button, Icon, Pill } from "./ui";

type SearchFilter = "all" | SearchEntityType;

const LABELS: Record<SearchEntityType, string> = {
  employee: "Employee",
  agent: "Agent",
  task: "Task",
  goal: "Goal",
  project: "Project",
  workspace: "Workspace",
  approval: "Approval",
  chat_space: "Space",
  chat_message: "Message",
  file: "File",
  provider: "Provider",
  social_account: "Social",
  scheduled_post: "Post",
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
  onNavigate: (route: RouteId) => void;
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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const first = visibleResults[0];
    if (!first) return;
    onNavigate(routeFor(first.entityType));
    onClose();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Search" style={overlayStyle}>
      <form onSubmit={submit} style={panelStyle}>
        <div className="row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-soft)" }}>
          <Icon name="search" size={14} color="var(--text-3)" />
          <input
            autoFocus
            aria-label="Search query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={inputStyle}
          />
          <select
            aria-label="Search filter"
            className="input"
            value={filter}
            onChange={(event) => setFilter(event.target.value as SearchFilter)}
            style={{ width: 150, height: 28, padding: "2px 8px", fontSize: 12 }}
          >
            <option value="all">All</option>
            {SEARCH_ENTITY_TYPES.map((type) => <option key={type} value={type}>{LABELS[type]}</option>)}
          </select>
          <Button size="small" onClick={onClose}>Close</Button>
        </div>
        <div style={{ maxHeight: 420, overflow: "auto", padding: 8 }}>
          {visibleResults.map((result) => (
            <button
              key={`${result.entityType}:${result.entityId}`}
              type="button"
              onClick={() => {
                onNavigate(routeFor(result.entityType));
                onClose();
              }}
              style={rowStyle}
            >
              <Pill>{LABELS[result.entityType]}</Pill>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.preview}</div>
              </div>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>{result.facets.type}</span>
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

function routeFor(entityType: SearchEntityType): RouteId {
  if (entityType === "employee" || entityType === "agent") return "team";
  if (entityType === "approval") return "approvals";
  if (entityType === "chat_space" || entityType === "chat_message") return "chat";
  if (entityType === "file") return "files";
  if (entityType === "provider") return "settings";
  if (entityType === "social_account" || entityType === "scheduled_post") return "social";
  return "work";
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
