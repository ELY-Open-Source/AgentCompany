import { useCallback, useDeferredValue, useMemo } from "react";
import { useShallow } from "zustand/shallow";
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
} from "../components/ui/icons";
import type { AppLocale } from "@shared/locale";

type NavItemDef = { id: SectionId; labelKey: string; icon: typeof SquaresFour };
export type NavItem = { id: SectionId; label: string; icon: typeof SquaresFour };
export type NavGroup = { items: NavItem[] };
export type PaletteAction = { key: string; section: SectionId; entityId?: string };

const sidebarCoreDefs: NavItemDef[] = [
  { id: "overview", labelKey: "nav.overview", icon: SquaresFour },
  { id: "inbox", labelKey: "nav.inbox", icon: Tray },
  { id: "communication", labelKey: "nav.communication", icon: ChatCircle },
];

const sidebarCollaborateDefs: NavItemDef[] = [
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

const NO_MOTION = { duration: 0 } as const;
const PAGE_TRANSITION = { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const } as const;
const PANEL_TRANSITION = { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const } as const;

export function useUIController() {
  const reducedMotion = useReducedMotion();
  const pageTransition = reducedMotion ? NO_MOTION : PAGE_TRANSITION;
  const panelTransition = reducedMotion ? NO_MOTION : PANEL_TRANSITION;

  const locale = useAppStore((s) => s.locale);
  const t = useMemo(() => createTranslator(locale), [locale]);

  const sidebarGroups: NavGroup[] = useMemo(
    () => [
      { items: sidebarCoreDefs.map((item) => ({ id: item.id, label: t(item.labelKey), icon: item.icon })) },
      { items: sidebarCollaborateDefs.map((item) => ({ id: item.id, label: t(item.labelKey), icon: item.icon })) },
    ],
    [t],
  );
  const sidebarNav: NavItem[] = useMemo(
    () => sidebarGroups.flatMap((group) => group.items),
    [sidebarGroups],
  );
  const navItems: NavItem[] = useMemo(
    () =>
      sidebarNav
        .concat(paletteOnlyNavDefs.map((item) => ({ id: item.id, label: t(item.labelKey), icon: item.icon })))
        .concat({ id: "settings", label: t("nav.settings"), icon: Gear }),
    [sidebarNav, t],
  );

  const {
    section,
    consoleOpen,
    sidebarCollapsed,
    companySwitcherOpen,
    confirmDeleteCompanyId,
    taskViewMode,
    showOnboarding,
    initialOnboardingLocked,
    commandPaletteOpen,
    commandPaletteSearch,
    selectedPaletteIndex,
  } = useAppStore(
    useShallow((s) => ({
      section: s.section,
      consoleOpen: s.consoleOpen,
      sidebarCollapsed: s.sidebarCollapsed,
      companySwitcherOpen: s.companySwitcherOpen,
      confirmDeleteCompanyId: s.confirmDeleteCompanyId,
      taskViewMode: s.taskViewMode,
      showOnboarding: s.showOnboarding,
      initialOnboardingLocked: s.initialOnboardingLocked,
      commandPaletteOpen: s.commandPaletteOpen,
      commandPaletteSearch: s.commandPaletteSearch,
      selectedPaletteIndex: s.selectedPaletteIndex,
    })),
  );
  const {
    setSection,
    setConsoleOpen,
    setSidebarCollapsed,
    setCompanySwitcherOpen,
    setConfirmDeleteCompanyId,
    setTaskViewMode,
    setShowOnboarding,
    setInitialOnboardingLocked,
    setCommandPaletteOpen,
    setCommandPaletteSearch,
    setSelectedPaletteIndex,
  } = useAppStore.getState();

  const handleLocaleChange = useCallback(async (newLocale: AppLocale) => {
    useAppStore.getState().setLocale(newLocale);
    try {
      await window.agentCompany.updateSettings({ locale: newLocale });
    } catch (error) {
      console.warn(
        `[renderer/useUIController] persist locale=${newLocale} failed (local state already updated): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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

  // HOOK-001 fix: wrap the 27-field return in a stable useMemo so downstream
  // `useMemo([ui, ...])` consumers do not bust on every render. Every field
  // is listed in the dep array; Zustand setters from getState() are stable
  // references.
  return useMemo(
    () => ({
      pageTransition,
      panelTransition,
      locale,
      t,
      handleLocaleChange,
      sidebarNav,
      sidebarGroups,
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
    }),
    [
      pageTransition,
      panelTransition,
      locale,
      t,
      handleLocaleChange,
      sidebarNav,
      sidebarGroups,
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
    ],
  );
}
