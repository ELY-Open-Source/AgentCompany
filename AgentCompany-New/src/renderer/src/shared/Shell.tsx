import type { ReactNode } from "react";
import type { AppSnapshot } from "../../../shared/domain";
import { Avatar, Icon, IconButton } from "./ui";

export type RouteId = "home" | "team" | "work" | "chat" | "files" | "approvals" | "social" | "settings";

const navItems: Array<{ id: RouteId; label: string; icon: string }> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "team", label: "Team", icon: "team" },
  { id: "work", label: "Work", icon: "work" },
  { id: "chat", label: "Messages", icon: "chat" },
  { id: "files", label: "Files", icon: "docs" },
  { id: "approvals", label: "Approvals", icon: "approve" },
  { id: "social", label: "Social", icon: "social" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export function Shell({
  snapshot,
  route,
  setRoute,
  actions,
  children,
}: {
  snapshot: AppSnapshot;
  route: RouteId;
  setRoute: (route: RouteId) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const organization = snapshot.organizations.find((item) => item.id === snapshot.activeOrgId);
  const employee = snapshot.employees.find((item) => item.orgId === snapshot.activeOrgId);
  const badges = {
    work: snapshot.tasks.filter((item) => item.orgId === snapshot.activeOrgId && item.status !== "done").length,
    chat: snapshot.chatMessages.filter((item) => item.orgId === snapshot.activeOrgId).length,
    approvals: snapshot.approvals.filter((item) => item.orgId === snapshot.activeOrgId && item.state === "pending").length,
  } as Partial<Record<RouteId, number>>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div className="brand-name">{organization?.name ?? "AgentCompany"}</div>
          <Icon name="chevronDown" size={12} />
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${route === item.id ? "active" : ""}`}
              onClick={() => setRoute(item.id)}
            >
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
              {badges[item.id] ? <span className="nav-badge">{badges[item.id]}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Avatar name={employee?.displayName ?? "User"} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>{employee?.displayName ?? "User"}</div>
          <Icon name="bell" />
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="crumb-sub">{organization?.name ?? "Workspace"}</span>
          <span style={{ color: "var(--text-4)" }}>/</span>
          <span className="crumb">{navItems.find((item) => item.id === route)?.label}</span>
          <div className="topbar-actions">
            {actions}
            {window.agentCompany.platform !== "darwin" && (
              <>
                <IconButton icon="more" label="Minimize" onClick={() => void window.agentCompany.windowMinimize()} />
                <IconButton icon="x" label="Close" onClick={() => void window.agentCompany.windowClose()} />
              </>
            )}
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
