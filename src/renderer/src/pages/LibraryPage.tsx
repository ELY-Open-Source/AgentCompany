import { useMemo, useState } from "react";
import { DocumentsPanel } from "./library/DocumentsPanel";
import { KnowledgePanel } from "./library/KnowledgePanel";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee } from "./types";
import { t } from "../i18n/i18n";

type LibraryTab = "documents" | "knowledge";

const TABS: Array<{ id: LibraryTab; label: string }> = [
  { id: "documents", label: t("Documents") },
  { id: "knowledge", label: t("Knowledge") },
];

export function LibraryPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const [tab, setTab] = useState<LibraryTab>("documents");
  const documents = useMemo(() => inOrg(snapshot.documents, orgId), [snapshot.documents, orgId]);
  const entries = useMemo(() => inOrg(snapshot.knowledgeEntries, orgId), [snapshot.knowledgeEntries, orgId]);
  const tasks = useMemo(() => inOrg(snapshot.tasks, orgId), [snapshot.tasks, orgId]);
  const scopes = useMemo(() => ({
    projects: inOrg(snapshot.projects, orgId),
    goals: inOrg(snapshot.goals, orgId),
    tasks,
    agents: inOrg(snapshot.agents, orgId),
  }), [snapshot.projects, snapshot.goals, snapshot.agents, tasks, orgId]);

  return (
    <div className="split-main">
      <aside className="secondary-pane">
        <div style={{ fontSize: 14, fontWeight: 600, padding: "4px 8px 14px" }}>{t("Library")}</div>
        <div className="nav" style={{ gap: 1 }}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={item.id === tab}
              className={`nav-item ${item.id === tab ? "active" : ""}`.trim()}
              onClick={() => setTab(item.id)}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="main" style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
        <div className="content">
          <div className="page">
            <h1 className="page-h1">{tab === "documents" ? t("Documents") : t("Knowledge")}</h1>
            {tab === "documents"
              ? <DocumentsPanel orgId={orgId} employeeId={employee.id} documents={documents} tasks={tasks} actions={actions} />
              : <KnowledgePanel orgId={orgId} employeeId={employee.id} entries={entries} scopes={scopes} actions={actions} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function inOrg<T extends { orgId: string }>(items: T[], orgId: string): T[] {
  return items.filter((item) => item.orgId === orgId);
}
