import { useCallback, useDeferredValue, useMemo } from "react";
import type { AgentRecord, GoalRecord, ProjectRecord, RunRecord, SectionId, TaskRecord } from "@shared/types";

import { createTranslator } from "../i18n";
import { useAppStore } from "../state/store";
import { useFocusTrap, useReducedMotion } from "../components/ui";
import {
  BookOpen,
  Gear,
  Tray,
  SquaresFour,
  UsersThree,
  ListChecks,
  ChatCircle,
  PuzzlePiece,
  FileText,
  ShieldCheck,
  Megaphone,
  FolderOpen,
} from "@phosphor-icons/react";
import type { AppLocale } from "@shared/locale";

type NavItemDef = { id: SectionId; labelKey: string; icon: typeof SquaresFour };
export type NavItem = { id: SectionId; label: string; icon: typeof SquaresFour };
export type PaletteAction = { key: string; section: SectionId; entityId?: string };

const sidebarNavDefs: NavItemDef[] = [
  { id: "overview", labelKey: "nav.overview", icon: SquaresFour },
  { id: "inbox", labelKey: "nav.inbox", icon: Tray },
  { id: "communication", labelKey: "nav.communication", icon: ChatCircle },
  { id: "tasks", labelKey: "nav.work", icon: ListChecks },
  { id: "approvals", labelKey: "nav.approvals", icon: ShieldCheck },
  { id: "agents", labelKey: "nav.agents", icon: UsersThree },
  { id: "workspaces", labelKey: "nav.workspaces", icon: FolderOpen },
  { id: "social", labelKey: "nav.social", icon: Megaphone },
  { id: "documents", labelKey: "nav.documents", icon: FileText },
];

const paletteOnlyNavDefs: NavItemDef[] = [
  { id: "skills", labelKey: "nav.skills", icon: PuzzlePiece },
  { id: "knowledge", labelKey: "nav.knowledge", icon: BookOpen },
];

export function useUIController() {
  const reducedMotion = useReducedMotion();
  const noMotion = { duration: 0 };
  const pageTransition = reducedMotion ? noMotion : { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const };
  const panelTransition = reducedMotion ? noMotion : { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const };

  const locale = useAppStore((s) => s.locale);
  const t = useMemo(() => createTranslator(locale), [locale]);

  const sidebarNav: NavItem[] = useMemo(
    () => sidebarNavDefs.map((item) => ({ id: item.id, label: t(item.labelKey), icon: item.icon })),
    [t],
  );
  const navItems: NavItem[] = useMemo(
    () =>
      sidebarNav
        .concat(paletteOnlyNavDefs.map((item) => ({ id: item.id, label: t(item.labelKey), icon: item.icon })))
        .concat({ id: "settings", label: t("nav.settings"), icon: Gear }),
    [sidebarNav, t],
  );

  const section = useAppStore((s) => s.section);
  const setSection = useAppStore((s) => s.setSection);
  const consoleOpen = useAppStore((s) => s.consoleOpen);
  const setConsoleOpen = useAppStore((s) => s.setConsoleOpen);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const companySwitcherOpen = useAppStore((s) => s.companySwitcherOpen);
  const setCompanySwitcherOpen = useAppStore((s) => s.setCompanySwitcherOpen);
  const confirmDeleteCompanyId = useAppStore((s) => s.confirmDeleteCompanyId);
  const setConfirmDeleteCompanyId = useAppStore((s) => s.setConfirmDeleteCompanyId);
  const taskViewMode = useAppStore((s) => s.taskViewMode);
  const setTaskViewMode = useAppStore((s) => s.setTaskViewMode);
  const showOnboarding = useAppStore((s) => s.showOnboarding);
  const setShowOnboarding = useAppStore((s) => s.setShowOnboarding);
  const initialOnboardingLocked = useAppStore((s) => s.initialOnboardingLocked);
  const setInitialOnboardingLocked = useAppStore((s) => s.setInitialOnboardingLocked);
  const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const commandPaletteSearch = useAppStore((s) => s.commandPaletteSearch);
  const setCommandPaletteSearch = useAppStore((s) => s.setCommandPaletteSearch);
  const selectedPaletteIndex = useAppStore((s) => s.selectedPaletteIndex);
  const setSelectedPaletteIndex = useAppStore((s) => s.setSelectedPaletteIndex);

  const handleLocaleChange = useCallback(async (newLocale: AppLocale) => {
    useAppStore.getState().setLocale(newLocale);
    try { await window.agentCompany.updateSettings({ locale: newLocale }); } catch { /* local state already updated */ }
  }, []);

  const paletteTrapRef = useFocusTrap(commandPaletteOpen);

  const paletteQuery = useDeferredValue(commandPaletteSearch.trim().toLowerCase());

  const buildPaletteResults = useCallback((
    navItemsList: NavItem[],
    companyAgents: AgentRecord[],
    tasks: TaskRecord[],
    runs: RunRecord[],
    companyGoals: GoalRecord[],
    companyProjects: ProjectRecord[],
  ) => {
    const filteredNavItems = paletteQuery
      ? navItemsList.filter((item) => item.label.toLowerCase().includes(paletteQuery) || item.id.toLowerCase().includes(paletteQuery))
      : navItemsList;
    const matchedAgents = paletteQuery ? companyAgents.filter((a) => a.name.toLowerCase().includes(paletteQuery) || a.role.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const matchedTasks = paletteQuery ? tasks.filter((task) => task.title.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const matchedRuns = paletteQuery ? runs.filter((run) => {
      const matchingTask = tasks.find((task) => task.id === run.taskId);
      return [run.id, run.summary ?? "", run.errorMessage ?? "", matchingTask?.title ?? "", run.connectorId]
        .some((value) => value.toLowerCase().includes(paletteQuery));
    }).slice(0, 5) : [];
    const matchedGoals = paletteQuery ? companyGoals.filter((g) => g.title.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const matchedProjects = paletteQuery ? companyProjects.filter((p) => p.name.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const hasEntityResults = matchedAgents.length > 0 || matchedTasks.length > 0 || matchedRuns.length > 0 || matchedGoals.length > 0 || matchedProjects.length > 0;
    return { filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects, hasEntityResults };
  }, [paletteQuery]);

  const buildPaletteActions = useCallback((
    filteredNavItems: NavItem[],
    matchedAgents: AgentRecord[],
    matchedTasks: TaskRecord[],
    matchedRuns: RunRecord[],
    matchedGoals: GoalRecord[],
    matchedProjects: ProjectRecord[],
  ): PaletteAction[] => ([
    ...filteredNavItems.map((item) => ({ key: `section:${item.id}`, section: item.id })),
    ...matchedAgents.map((agent) => ({ key: `agent:${agent.id}`, section: "agents" as const, entityId: agent.id })),
    ...matchedTasks.map((task) => ({ key: `task:${task.id}`, section: "tasks" as const, entityId: task.id })),
    ...matchedRuns.map((run) => ({ key: `run:${run.id}`, section: "runs" as const, entityId: run.id })),
    ...matchedGoals.map((goal) => ({ key: `goal:${goal.id}`, section: "goals" as const, entityId: goal.id })),
    ...matchedProjects.map((project) => ({ key: `project:${project.id}`, section: "projects" as const, entityId: project.id })),
  ]), []);

  return {
    pageTransition,
    panelTransition,
    locale,
    t,
    handleLocaleChange,
    sidebarNav,
    navItems,
    section,
    setSection,
    consoleOpen,
    setConsoleOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    companySwitcherOpen,
    setCompanySwitcherOpen,
    confirmDeleteCompanyId,
    setConfirmDeleteCompanyId,
    taskViewMode,
    setTaskViewMode,
    showOnboarding,
    setShowOnboarding,
    initialOnboardingLocked,
    setInitialOnboardingLocked,
    commandPaletteOpen,
    setCommandPaletteOpen,
    commandPaletteSearch,
    setCommandPaletteSearch,
    selectedPaletteIndex,
    setSelectedPaletteIndex,
    paletteQuery,
    paletteTrapRef,
    buildPaletteResults,
    buildPaletteActions,
  };
}
