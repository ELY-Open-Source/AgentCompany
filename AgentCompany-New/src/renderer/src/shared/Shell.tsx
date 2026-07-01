import { useEffect, useState, type ReactNode } from "react";
import type { AppSnapshot } from "../../../shared/domain";
import { Avatar, Icon, IconButton } from "./ui";
import type { IconName } from "./Icon";
import { OrgSwitcher } from "./OrgSwitcher";
import { SearchDialog } from "./SearchDialog";
import { TopbarSlotContext } from "./topbar-context";
import { VirtualOffice } from "./VirtualOffice";

export type RouteId =
  | "home"
  | "team"
  | "work"
  | "chat"
  | "files"
  | "docs"
  | "knowledge"
  | "inbox"
  | "runs"
  | "meetings"
  | "sprints"
  | "approvals"
  | "social"
  | "settings";

interface NavSpec {
  id: RouteId;
  label: string;
  icon: IconName;
}

/** Routes whose pages own a full-height, multi-pane layout with their own
 * internal scroll regions, so the content area must not scroll as one block. */
const FLUSH_ROUTES = new Set<RouteId>(["chat", "settings", "files", "social", "runs"]);

/** The daily-driver surfaces — the core operating loop. */
const primaryNav: NavSpec[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "work", label: "Work", icon: "work" },
  { id: "team", label: "Team", icon: "team" },
  { id: "chat", label: "Messages", icon: "chat" },
  { id: "runs", label: "Runs", icon: "send" },
  { id: "files", label: "Files", icon: "folder" },
  { id: "approvals", label: "Approvals", icon: "approve" },
];

/** Less-frequent surfaces, demoted under a divider so the primary set leads. */
const secondaryNav: NavSpec[] = [
  { id: "inbox", label: "Inbox", icon: "inbox" },
  { id: "docs", label: "Documents", icon: "file" },
  { id: "knowledge", label: "Knowledge", icon: "sparkle" },
  { id: "meetings", label: "Meetings", icon: "calendar" },
  { id: "sprints", label: "Sprints", icon: "target" },
  { id: "social", label: "Social", icon: "social" },
];

const allNav: NavSpec[] = [...primaryNav, ...secondaryNav];

export function Shell({
  snapshot,
  route,
  setRoute,
  onSwitchOrg,
  onDeleteOrg,
  onNewOrg,
  children,
}: {
  snapshot: AppSnapshot;
  route: RouteId;
  setRoute: (route: RouteId) => void;
  onSwitchOrg: (orgId: string) => void;
  onDeleteOrg: (orgId: string) => void;
  onNewOrg: () => void;
  children: ReactNode;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [officeOpen, setOfficeOpen] = useState(false);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const organization = snapshot.organizations.find((item) => item.id === snapshot.activeOrgId);
  const employee = snapshot.employees.find((item) => item.orgId === snapshot.activeOrgId);
  if (!organization) throw new Error("Active organization is missing.");
  if (!employee) throw new Error("Active employee is missing.");
  const badges = computeBadges(snapshot, organization.id);
  const activeLabel = labelFor(route);

  const isMac = window.agentCompany.platform === "darwin";

  return (
    <div className={`app-shell ${isMac ? "is-mac" : ""}`.trim()}>
      <aside className="sidebar">
        <OrgSwitcher
          snapshot={snapshot}
          activeOrgId={organization.id}
          onSelect={onSwitchOrg}
          onNew={onNewOrg}
          onDelete={onDeleteOrg}
        />
        <button type="button" className="search-bar" aria-label="Search" onClick={() => setSearchOpen(true)}>
          <Icon name="search" size={13} />
          <span>Search</span>
          <span className="search-kbd">⌘K</span>
        </button>
        <nav className="nav">
          {primaryNav.map((item) => (
            <NavButton key={item.id} item={item} active={route === item.id} badge={badges[item.id]} onSelect={setRoute} />
          ))}
        </nav>
        <div className="nav-divider" />
        <nav className="nav">
          {secondaryNav.map((item) => (
            <NavButton key={item.id} item={item} active={route === item.id} badge={badges[item.id]} onSelect={setRoute} />
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <nav className="nav">
          <button
            type="button"
            aria-label="Office"
            className={`nav-item ${officeOpen ? "active" : ""}`.trim()}
            onClick={() => setOfficeOpen((v) => !v)}
          >
            <span className="icon-box"><Icon name="team" size={18} /></span>
            <span>Office</span>
          </button>
          <button
            type="button"
            aria-label="Settings"
            aria-current={route === "settings" ? "page" : undefined}
            className={`nav-item ${route === "settings" ? "active" : ""}`.trim()}
            onClick={() => setRoute("settings")}
          >
            <span className="icon-box"><Icon name="settings" size={18} /></span>
            <span>Settings</span>
          </button>
        </nav>
        <div className="sidebar-foot">
          <Avatar name={employee.displayName} size="sm" />
          <span className="sidebar-foot-name">{employee.displayName}</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="crumb-sub">{organization.name}</span>
          <span className="crumb-sep">/</span>
          <span className="crumb">{activeLabel}</span>
          <div className="topbar-actions">
            <span className="topbar-actions-slot" ref={setActionsSlot} />
            {!isMac && (
              <span className="window-controls">
                <IconButton icon="minus" label="Minimize" onClick={() => void window.agentCompany.windowMinimize()} />
                <IconButton icon="grid" label="Maximize" onClick={() => void window.agentCompany.windowMaximize()} />
                <IconButton icon="x" label="Close" onClick={() => void window.agentCompany.windowClose()} />
              </span>
            )}
          </div>
        </header>
        <div className={FLUSH_ROUTES.has(route) ? "content flush" : "content"}>
          <TopbarSlotContext.Provider value={actionsSlot}>
            <div key={route} className="route-view">{children}</div>
          </TopbarSlotContext.Provider>
        </div>
      </main>
      {officeOpen && (
        <aside className="office-sidebar">
          <div className="office-sidebar-header">
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>Office</span>
            <IconButton icon="x" label="Close office" onClick={() => setOfficeOpen(false)} />
          </div>
          <VirtualOffice
            agents={snapshot.agents}
            tasks={snapshot.tasks}
            presence={snapshot.chatPresence}
            orgId={organization.id}
          />
        </aside>
      )}
      <SearchDialog
        snapshot={snapshot}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={setRoute}
      />
    </div>
  );
}


function NavButton({
  item,
  active,
  badge,
  onSelect,
}: {
  item: NavSpec;
  active: boolean;
  badge: number | undefined;
  onSelect: (route: RouteId) => void;
}) {
  return (
    <button
      type="button"
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={`nav-item ${active ? "active" : ""}`.trim()}
      onClick={() => onSelect(item.id)}
    >
      <span className="icon-box"><Icon name={item.icon} size={18} /></span>
      <span>{item.label}</span>
      {renderBadge(badge)}
    </button>
  );
}

function labelFor(route: RouteId): string {
  const spec = allNav.find((item) => item.id === route);
  if (spec) return spec.label;
  if (route === "settings") return "Settings";
  throw new Error(`Unknown route: ${route}`);
}

function renderBadge(value: number | undefined): ReactNode {
  if (!value || value <= 0) return null;
  return <span className="nav-badge">{value > 99 ? "99+" : value}</span>;
}

function computeBadges(snapshot: AppSnapshot, orgId: string): Partial<Record<RouteId, number>> {
  const employee = snapshot.employees.find((item) => item.orgId === orgId);
  const tasks = snapshot.tasks.filter((item) => item.orgId === orgId);
  const approvals = snapshot.approvals.filter((item) => item.orgId === orgId);
  return {
    work: tasks.filter((task) => task.status !== "done").length,
    chat: employee ? countUnreadMessages(snapshot, orgId, employee.id) : 0,
    approvals: approvals.filter((approval) => approval.state === "pending").length,
  };
}

function countUnreadMessages(snapshot: AppSnapshot, orgId: string, employeeId: string): number {
  const readByspace = new Map<string, string>();
  for (const state of snapshot.chatReadStates) {
    if (state.orgId !== orgId || state.employeeId !== employeeId) continue;
    readByspace.set(state.spaceId, state.lastReadAt);
  }
  let unread = 0;
  for (const message of snapshot.chatMessages) {
    if (message.orgId !== orgId) continue;
    if (message.senderType === "employee" && message.senderId === employeeId) continue;
    const lastRead = readByspace.get(message.spaceId);
    if (lastRead && message.createdAt <= lastRead) continue;
    unread += 1;
  }
  return unread;
}
