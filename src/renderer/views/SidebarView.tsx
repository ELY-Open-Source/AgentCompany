import {
  CaretUpDown,
  Check,
  Command,
  Gear,
  Plus,
  SidebarSimple,
  Trash,
} from "@phosphor-icons/react";
import type { CompanyRecord, ProfileSnapshot, SectionId } from "@shared/types";
import { SectionButton } from "../components/ui";

type NavItem = { id: SectionId; label: string; icon: typeof Gear };

interface SidebarViewProps {
  isMac: boolean;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (value: boolean) => void;
  section: SectionId;
  setSection: (section: SectionId) => void;
  sidebarNav: NavItem[];
  navBadges: Partial<Record<SectionId, { count: number; tone: "default" | "warn" | "danger" }>>;
  companySwitcherOpen: boolean;
  setCompanySwitcherOpen: (value: boolean) => void;
  confirmDeleteCompanyId: string | null;
  setConfirmDeleteCompanyId: (id: string | null) => void;
  currentCompany: CompanyRecord | null;
  snapshot: ProfileSnapshot;
  setCompany: (companyId: string) => void;
  deleteCompany: (companyId: string) => void;
  setCommandPaletteOpen: (value: boolean) => void;
  t: (key: string) => string;
}

export function SidebarView({
  isMac,
  sidebarCollapsed,
  setSidebarCollapsed,
  section,
  setSection,
  sidebarNav,
  navBadges,
  companySwitcherOpen,
  setCompanySwitcherOpen,
  confirmDeleteCompanyId,
  setConfirmDeleteCompanyId,
  currentCompany,
  snapshot,
  setCompany,
  deleteCompany,
  setCommandPaletteOpen,
  t,
}: SidebarViewProps) {
  return (
    <aside className="flex h-full flex-col overflow-hidden border-r border-border bg-card">
      {sidebarCollapsed ? (
        <div className={`sidebar-drag flex items-center justify-center px-2 pb-3 ${isMac ? "pt-[38px]" : "pt-3"}`}>
          <button
            aria-label="Open command palette"
            title={`Command palette (${isMac ? "⌘" : "Ctrl+"}K)`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={() => setCommandPaletteOpen(true)}
          >
            <Command size={14} />
          </button>
        </div>
      ) : (
        <div className={`sidebar-drag flex items-center gap-2.5 px-4 pb-4 ${isMac ? "pt-[38px]" : "pt-3"}`}>
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left text-[13px] font-medium text-foreground transition hover:bg-muted"
              onClick={() => setCompanySwitcherOpen(!companySwitcherOpen)}
            >
              <span className="min-w-0 flex-1 truncate">{currentCompany?.name ?? t("app.selectCompany")}</span>
              <CaretUpDown size={14} className="shrink-0 text-muted-foreground" />
            </button>
            {companySwitcherOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setCompanySwitcherOpen(false); setConfirmDeleteCompanyId(null); }} />
                <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                  <div className="max-h-[240px] overflow-y-auto py-1">
                    {snapshot.companies.map((company) => (
                      <div key={company.id} className="group flex items-center">
                        {confirmDeleteCompanyId === company.id ? (
                          <div className="flex w-full items-center gap-2 px-3 py-2">
                            <span className="flex-1 truncate text-[12px] text-destructive">Delete {company.name}?</span>
                            <button
                              type="button"
                              className="rounded px-2 py-0.5 text-[11px] font-semibold text-destructive transition hover:bg-destructive hover:text-primary-foreground"
                              onClick={() => void deleteCompany(company.id)}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              className="rounded px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted"
                              onClick={() => setConfirmDeleteCompanyId(null)}
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={`flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-[13px] transition hover:bg-muted ${
                                company.id === currentCompany?.id ? "font-semibold text-foreground" : "text-muted-foreground"
                              }`}
                              onClick={() => { void setCompany(company.id); setCompanySwitcherOpen(false); }}
                            >
                              <span className="w-4 shrink-0">{company.id === currentCompany?.id ? <Check size={14} weight="bold" className="text-primary" /> : null}</span>
                              <span className="min-w-0 flex-1 truncate">{company.name}</span>
                            </button>
                            <button
                              type="button"
                              className="mr-2 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-destructive hover:text-primary-foreground group-hover:opacity-100"
                              title={`Delete ${company.name}`}
                              onClick={() => setConfirmDeleteCompanyId(company.id)}
                            >
                              <Trash size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      onClick={() => { void setCompany("__new__"); setCompanySwitcherOpen(false); }}
                    >
                      <Plus size={14} />
                      <span>{t("app.newCompany")}</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          <button
            aria-label={`Open command palette (${isMac ? "⌘" : "Ctrl+"}K)`}
            title={`Command palette (${isMac ? "⌘" : "Ctrl+"}K)`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex h-[30px] shrink-0 items-center justify-center gap-1 rounded-lg border border-border px-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={() => setCommandPaletteOpen(true)}
          >
            <Command size={14} />
            <kbd className="text-[10px] font-medium text-muted-foreground">{isMac ? "⌘K" : "^K"}</kbd>
          </button>
        </div>
      )}
      <nav aria-label="Main navigation" className={`flex-1 overflow-y-auto pb-3 ${sidebarCollapsed ? "px-1.5 pt-2" : "px-3 pt-2"}`}>
        {/* Core: Overview, Team, Work */}
        <div className="space-y-0.5">
          {sidebarNav.slice(0, 3).map((item) => (
            <SectionButton key={item.id} active={section === item.id} label={item.label} icon={item.icon} onClick={() => setSection(item.id)} badge={navBadges[item.id]?.count} badgeTone={navBadges[item.id]?.tone} collapsed={sidebarCollapsed} />
          ))}
        </div>
        <div className={`my-2 border-t border-border ${sidebarCollapsed ? "mx-1" : "mx-2"}`} />
        {/* Collaborate & Extend: Communication, Skills, Documents, Approvals, Social */}
        <div className="space-y-0.5">
          {sidebarNav.slice(3).map((item) => (
            <SectionButton key={item.id} active={section === item.id} label={item.label} icon={item.icon} onClick={() => setSection(item.id)} badge={navBadges[item.id]?.count} badgeTone={navBadges[item.id]?.tone} collapsed={sidebarCollapsed} />
          ))}
        </div>
      </nav>
      <div className={`border-t border-border py-2 ${sidebarCollapsed ? "px-1.5" : "px-3"}`}>
        <SectionButton
          active={section === "settings"}
          label="Settings"
          icon={Gear}
          onClick={() => setSection("settings")}
          collapsed={sidebarCollapsed}
        />
        <button
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 mt-1 flex w-full items-center rounded-lg py-[7px] text-muted-foreground transition duration-150 hover:bg-muted hover:text-foreground ${sidebarCollapsed ? "justify-center p-2" : "gap-2.5 px-3"}`}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          <SidebarSimple size={sidebarCollapsed ? 18 : 17} />
          {!sidebarCollapsed ? <span className="text-[13px] font-medium tracking-[0.005em]">{t("app.collapse")}</span> : null}
        </button>
      </div>
    </aside>
  );
}
