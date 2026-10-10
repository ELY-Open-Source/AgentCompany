import type { Focus } from "../pages/types";
import { connectorsEnabled, type RouteId } from "./routes";
import { shortcutLabel } from "../i18n/labels";
import { isBusinessTask } from "../pages/work/task-helpers";
import { unreadBySpace } from "../pages/chat/chat-helpers";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AppSnapshot, EmployeeRecord } from "../../../shared/domain";
import { Avatar, Field, Icon, IconButton } from "./ui";
import { AvatarField } from "./AvatarField";
import { Dialog } from "./Dialog";
import { NavIcon } from "./NavIcon";
import { OrgSwitcher } from "./OrgSwitcher";
import { SearchDialog } from "./SearchDialog";
import { TopbarSlotContext } from "./topbar-context";
import { t } from "../i18n/i18n";

export type { RouteId };


interface NavSpec {
  id: RouteId;
  label: string;
}

/** Routes whose pages own a full-height, multi-pane layout with their own
 * internal scroll regions, so the content area must not scroll as one block. */
const FLUSH_ROUTES = new Set<RouteId>(["chat", "settings", "files", "library", "runs", "office", "work"]);

const allNav: NavSpec[] = [
  { id: "home", label: t("Home") },
  { id: "work", label: t("Work") },
  { id: "team", label: t("Team") },
  { id: "office", label: t("Office") },
  { id: "chat", label: t("Messages") },
  { id: "runs", label: t("Runs") },
  { id: "files", label: t("Files") },
  { id: "library", label: t("Library") },
  { id: "approvals", label: t("Approvals") },
  { id: "connectors", label: t("Connectors") },
];

export function Shell({
  snapshot,
  route,
  setRoute,
  onSwitchOrg,
  onDeleteOrg,
  onNewOrg,
  onOpen,
  children,
}: {
  snapshot: AppSnapshot;
  route: RouteId;
  setRoute: (route: RouteId) => void;
  /** Opens an object on its page, as a search hit does. */
  onOpen: (route: RouteId, focus: Focus) => void;
  onSwitchOrg: (orgId: string) => void;
  onDeleteOrg: (orgId: string) => void;
  onNewOrg: () => void;
  children: ReactNode;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
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
        <button type="button" className="search-bar" aria-label={t("Search")} onClick={() => setSearchOpen(true)}>
          <Icon name="search" />
          <span>{t("Search")}</span>
          <span className="search-kbd">{shortcutLabel("K")}</span>
        </button>
        <nav className="nav">
          {allNav.filter((item) => item.id !== "connectors" || connectorsEnabled(snapshot)).map((item) => (
            <NavButton key={item.id} item={item} active={route === item.id} badge={badges[item.id]} onSelect={setRoute} />
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <nav className="nav">
          <button
            type="button"
            aria-label={t("Settings")}
            aria-current={route === "settings" ? "page" : undefined}
            className={`nav-item ${route === "settings" ? "active" : ""}`.trim()}
            onClick={() => setRoute("settings")}
          >
            <span className="icon-box"><NavIcon route="settings" /></span>
            <span>{t("Settings")}</span>
          </button>
        </nav>
        <div className="sidebar-foot">
          <button
            type="button"
            className="sidebar-foot-button"
            aria-label={t("Edit profile")}
            onClick={() => setProfileOpen(true)}
          >
            <Avatar name={employee.displayName} size="sm" />
            <span className="sidebar-foot-name">{employee.displayName}</span>
          </button>
        </div>
      </aside>
      {profileOpen && <ProfileDialog key={employee.id} employee={employee} onClose={() => setProfileOpen(false)} />}
      <main className="main">
        <header className="topbar">
          <span className="crumb-sub">{organization.name}</span>
          <span className="crumb-sep">/</span>
          <span className="crumb">{activeLabel}</span>
          <div className="topbar-actions">
            <span className="topbar-actions-slot" ref={setActionsSlot} />
            <button
              type="button"
              className={`button ${snapshot.autonomousPaused ? "autopause-paused" : ""}`.trim()}
              aria-pressed={snapshot.autonomousPaused}
              title={snapshot.autonomousPaused
                ? t("Agents are paused: no new runs start until you resume. Click to resume.")
                : t("Pause all agents: the run already in flight finishes, nothing new starts.")}
              onClick={() => void window.agentCompany.setAutonomousPaused({ paused: !snapshot.autonomousPaused })}
            >
              <span aria-hidden>{snapshot.autonomousPaused ? "▶" : "⏸"}</span>
              {snapshot.autonomousPaused ? t("Agents paused") : t("Pause agents")}
            </button>
            {!isMac && (
              <span className="window-controls">
                <IconButton icon="minus" label={t("Minimize")} onClick={() => void window.agentCompany.windowMinimize()} />
                <IconButton icon="grid" label={t("Maximize")} onClick={() => void window.agentCompany.windowMaximize()} />
                <IconButton icon="x" label={t("Close")} onClick={() => void window.agentCompany.windowClose()} />
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
      <SearchDialog
        key={snapshot.activeOrgId ?? "none"}
        snapshot={snapshot}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={onOpen}
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
      <span className="icon-box"><NavIcon route={item.id} /></span>
      <span>{item.label}</span>
      {renderBadge(badge)}
    </button>
  );
}

function labelFor(route: RouteId): string {
  const spec = allNav.find((item) => item.id === route);
  if (spec) return spec.label;
  if (route === "settings") return t("Settings");
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
    work: tasks.filter((task) => task.status !== "done" && isBusinessTask(task)).length,
    chat: employee ? countUnreadMessages(snapshot, orgId, employee.id) : 0,
    approvals: approvals.filter((approval) => approval.state === "pending").length,
  };
}

function countUnreadMessages(snapshot: AppSnapshot, orgId: string, employeeId: string): number {
  const messages = snapshot.chatMessages.filter((message) => message.orgId === orgId);
  const readStates = snapshot.chatReadStates.filter((state) => state.orgId === orgId);
  let unread = 0;
  for (const count of unreadBySpace(messages, readStates, employeeId).values()) unread += count;
  return unread;
}

/**
 * The operator's own identity: display name plus avatar. Saves through the
 * standard mutate IPC, so the refreshed snapshot repaints every surface that
 * shows the user (sidebar, chat, org chart) at once.
 */
function ProfileDialog({ employee, onClose }: { employee: EmployeeRecord; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return window.agentCompany.updateEmployeeProfile({
      orgId: employee.orgId,
      employeeId: employee.id,
      displayName: String(form.get("displayName") ?? "").trim(),
      avatarEmoji: String(form.get("avatarEmoji") ?? ""),
      avatarColor: String(form.get("avatarColor") ?? ""),
      avatarImage: String(form.get("avatarImage") ?? ""),
    }).then((result) => {
      if (result.ok) onClose();
      else setError(result.error.message);
    });
  };
  return (
    <Dialog title={t("Edit profile")} open submitLabel={t("Save")} onClose={onClose} onSubmit={submit}>
      <Field label={t("Name")}><input className="input" name="displayName" defaultValue={employee.displayName} required /></Field>
      <AvatarField previewName={employee.displayName} defaultEmoji={employee.avatarEmoji} defaultColor={employee.avatarColor} defaultImage={employee.avatarImage} />
      {error && <div className="form-error" role="alert">{error}</div>}
    </Dialog>
  );
}
