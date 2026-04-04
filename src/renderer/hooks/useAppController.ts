import { useCallback, useDeferredValue, useEffect, useMemo, useRef } from "react";
import type {
  CompanyRecord,
  OnboardingBootstrapResult,
  SectionId,
} from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { createTranslator } from "../i18n";
import { useAppStore } from "../state/store";
import { unwrap } from "../lib/desktop";
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
import { useDesktopEvents } from "./useDesktopEvents";
import { useDataLoader } from "./useDataLoader";
import { useCompanyData } from "./useCompanyData";
import { useCommandPaletteHotkeys } from "./useCommandPaletteHotkeys";

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
  { id: "knowledge", labelKey: "nav.knowledge", icon: BookOpen },
  { id: "documents", labelKey: "nav.documents", icon: FileText },
];

const paletteOnlyNavDefs: NavItemDef[] = [
  { id: "skills", labelKey: "nav.skills", icon: PuzzlePiece },
  { id: "social", labelKey: "nav.social", icon: Megaphone },
];

export function useAppController() {
  const reducedMotion = useReducedMotion();
  const noMotion = { duration: 0 };
  const pageTransition = reducedMotion ? noMotion : { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const };
  const panelTransition = reducedMotion ? noMotion : { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const };

  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const t = useMemo(() => createTranslator(locale), [locale]);

  const sidebarNav: NavItem[] = useMemo(() => sidebarNavDefs.map((item) => ({ id: item.id, label: t(item.labelKey), icon: item.icon })), [t]);
  const navItems: NavItem[] = useMemo(
    () =>
      sidebarNav
        .concat(
          paletteOnlyNavDefs.map((item) => ({
            id: item.id,
            label: t(item.labelKey),
            icon: item.icon,
          })),
        )
        .concat({ id: "settings", label: t("nav.settings"), icon: Gear }),
    [sidebarNav, t],
  );

  const snapshot = useAppStore((s) => s.snapshot);
  const setSnapshot = useAppStore((s) => s.setSnapshot);
  const section = useAppStore((s) => s.section);
  const setSection = useAppStore((s) => s.setSection);
  const error = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const consoleOpen = useAppStore((s) => s.consoleOpen);
  const setConsoleOpen = useAppStore((s) => s.setConsoleOpen);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const companySwitcherOpen = useAppStore((s) => s.companySwitcherOpen);
  const setCompanySwitcherOpen = useAppStore((s) => s.setCompanySwitcherOpen);
  const confirmDeleteCompanyId = useAppStore((s) => s.confirmDeleteCompanyId);
  const setConfirmDeleteCompanyId = useAppStore((s) => s.setConfirmDeleteCompanyId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);
  const selectedConnectorId = useAppStore((s) => s.selectedConnectorId);
  const setSelectedConnectorId = useAppStore((s) => s.setSelectedConnectorId);
  const selectedApprovalId = useAppStore((s) => s.selectedApprovalId);
  const setSelectedApprovalId = useAppStore((s) => s.setSelectedApprovalId);
  const selectedRunId = useAppStore((s) => s.selectedRunId);
  const setSelectedRunId = useAppStore((s) => s.setSelectedRunId);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useAppStore((s) => s.setSelectedAgentId);
  const selectedGoalId = useAppStore((s) => s.selectedGoalId);
  const setSelectedGoalId = useAppStore((s) => s.setSelectedGoalId);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useAppStore((s) => s.setSelectedProjectId);
  const setSelectedWorkspaceId = useAppStore((s) => s.setSelectedWorkspaceId);
  const selectedCommunicationEntityId = useAppStore((s) => s.selectedCommunicationEntityId);
  const setSelectedCommunicationEntityId = useAppStore((s) => s.setSelectedCommunicationEntityId);
  const taskViewMode = useAppStore((s) => s.taskViewMode);
  const setTaskViewMode = useAppStore((s) => s.setTaskViewMode);
  const logBufferRef = useRef<Record<string, string>>({});
  const incrementLogRevision = useAppStore((s) => s.incrementLogRevision);
  const commandPaletteSearch = useAppStore((s) => s.commandPaletteSearch);
  const setCommandPaletteSearch = useAppStore((s) => s.setCommandPaletteSearch);
  const selectedPaletteIndex = useAppStore((s) => s.selectedPaletteIndex);
  const setSelectedPaletteIndex = useAppStore((s) => s.setSelectedPaletteIndex);
  const showOnboarding = useAppStore((s) => s.showOnboarding);
  const setShowOnboarding = useAppStore((s) => s.setShowOnboarding);
  const initialOnboardingLocked = useAppStore((s) => s.initialOnboardingLocked);
  const setInitialOnboardingLocked = useAppStore((s) => s.setInitialOnboardingLocked);
  const inboxItems = useAppStore((s) => s.inboxItems);
  const setInboxItems = useAppStore((s) => s.setInboxItems);
  const companyMetrics = useAppStore((s) => s.companyMetrics);
  const setCompanyMetrics = useAppStore((s) => s.setCompanyMetrics);
  const standupReport = useAppStore((s) => s.standupReport);
  const setStandupReport = useAppStore((s) => s.setStandupReport);
  const socialAccounts = useAppStore((s) => s.socialAccounts);
  const setSocialAccounts = useAppStore((s) => s.setSocialAccounts);
  const browserActions = useAppStore((s) => s.browserActions);
  const setBrowserActions = useAppStore((s) => s.setBrowserActions);
  const setBadges = useAppStore((s) => s.setBadges);

  const currentCompany = useMemo<CompanyRecord | null>(() => {
    if (!snapshot) return null;
    return snapshot.companies.find((company) => company.id === snapshot.currentCompanyId) ?? snapshot.companies[0] ?? null;
  }, [snapshot]);

  const companyData = useCompanyData(snapshot, currentCompany);
  const { tasks, runs, approvals, pendingApprovals, companyAgents, companyGoals, companyProjects,
    companyWorkspaces, companyCosts, filteredActivity, companySecrets, companyDocuments,
    companyKnowledge, companyMeetings, companySprints, selectedTask, selectedApproval,
    selectedRun, selectedAgent, selectedGoal, selectedProject, selectedWorkspace, navBadges } = companyData;

  const selectedConnector = snapshot?.connectors.find((connector) => connector.id === selectedConnectorId) ?? snapshot?.connectors[0] ?? null;

  const clearCompanyScopedUiState = useCallback(() => {
    const store = useAppStore.getState();
    store.clearCompanyScopedSelections();
    store.setInboxItems([]);
    store.setCompanyMetrics(null);
    store.setStandupReport(null);
    store.setSocialAccounts([]);
    store.setBrowserActions([]);
    store.setBadges(null);
    store.setSkills([]);
    store.setSelectedSkillId(null);
    store.setSelectedSkillFilePath("SKILL.md");
    store.setSkillImportModalOpen(false);
  }, []);

  const { refresh } = useDataLoader(
    snapshot, section, selectedConnectorId, selectedRunId,
    setSnapshot, setError, setInitialOnboardingLocked,
    setSelectedConnectorId, setSelectedRunId,
    setBadges, setInboxItems, setSocialAccounts, setBrowserActions,
    setCompanyMetrics, setStandupReport,
  );

  // Stable ref so the subscribe callback always calls the latest refresh
  // without tearing down the subscription when refresh identity changes.
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useDesktopEvents(refreshRef, logBufferRef, incrementLogRevision);

  useEffect(() => {
    if (!snapshot) return;
    const root = document.documentElement;
    const applyTheme = () => {
      const isDark = snapshot.theme === "dark" ||
        (snapshot.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", isDark);
      root.style.colorScheme = isDark ? "dark" : "light";
    };
    applyTheme();
    if (snapshot.locale && snapshot.locale !== locale) setLocale(snapshot.locale);
    if (snapshot.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", applyTheme);
      return () => mq.removeEventListener("change", applyTheme);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setLocale is a stable Zustand setter
  }, [snapshot, locale]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id ?? null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setSelectedRunId is a stable Zustand setter
  }, [runs, selectedRunId]);

  const activeRunId = selectedRun?.id ?? null;
  useEffect(() => {
    if (!activeRunId) return;
    void (async () => {
      const activeRun = runs.find((run) => run.id === activeRunId);
      if (!activeRun) return;
      const result = await window.agentCompany.getRunLog({ companyId: activeRun.companyId, runId: activeRunId });
      if (result.ok) {
        logBufferRef.current = { ...logBufferRef.current, [activeRunId]: result.data };
        incrementLogRevision();
        return;
      }
      setError(result.error.message);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- incrementLogRevision and setError are stable Zustand setters
  }, [activeRunId, runs]);

   
  const handleLocaleChange = useCallback(async (newLocale: AppLocale) => {
    setLocale(newLocale);
    try { await window.agentCompany.updateSettings({ locale: newLocale }); } catch { /* local state already updated */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setLocale is a stable Zustand setter
  }, []);

  const paletteTrapRef = useFocusTrap(commandPaletteOpen);

  const paletteQuery = useDeferredValue(commandPaletteSearch.trim().toLowerCase());
  const paletteResults = useMemo(() => {
    const filteredNavItems = paletteQuery
      ? navItems.filter((item) => item.label.toLowerCase().includes(paletteQuery) || item.id.toLowerCase().includes(paletteQuery))
      : navItems;
    const matchedAgents = paletteQuery ? companyAgents.filter((a) => a.name.toLowerCase().includes(paletteQuery) || a.role.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const matchedTasks = paletteQuery ? tasks.filter((t) => t.title.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const matchedRuns = paletteQuery ? runs.filter((run) => {
      const matchingTask = tasks.find((task) => task.id === run.taskId);
      return [run.id, run.summary ?? "", run.errorMessage ?? "", matchingTask?.title ?? "", run.connectorId]
        .some((value) => value.toLowerCase().includes(paletteQuery));
    }).slice(0, 5) : [];
    const matchedGoals = paletteQuery ? companyGoals.filter((g) => g.title.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const matchedProjects = paletteQuery ? companyProjects.filter((p) => p.name.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const hasEntityResults = matchedAgents.length > 0 || matchedTasks.length > 0 || matchedRuns.length > 0 || matchedGoals.length > 0 || matchedProjects.length > 0;
    return { filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects, hasEntityResults };
  }, [paletteQuery, companyAgents, companyGoals, companyProjects, runs, tasks, navItems]);
  const { filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects, hasEntityResults } = paletteResults;

  const paletteActions = useMemo<PaletteAction[]>(() => ([
    ...filteredNavItems.map((item) => ({ key: `section:${item.id}`, section: item.id })),
    ...matchedAgents.map((agent) => ({ key: `agent:${agent.id}`, section: "agents" as const, entityId: agent.id })),
    ...matchedTasks.map((task) => ({ key: `task:${task.id}`, section: "tasks" as const, entityId: task.id })),
    ...matchedRuns.map((run) => ({ key: `run:${run.id}`, section: "runs" as const, entityId: run.id })),
    ...matchedGoals.map((goal) => ({ key: `goal:${goal.id}`, section: "goals" as const, entityId: goal.id })),
    ...matchedProjects.map((project) => ({ key: `project:${project.id}`, section: "projects" as const, entityId: project.id })),
  ]), [filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects]);
  const paletteActionIndex = useMemo(() => new Map(paletteActions.map((action, index) => [action.key, index])), [paletteActions]);

  const navigateTo = useCallback((targetSection: SectionId, entityId?: string) => {
    setSection(targetSection);
    if (entityId) {
      if (targetSection === "agents") setSelectedAgentId(entityId);
      else if (targetSection === "connectors") setSelectedConnectorId(entityId);
      else if (targetSection === "runs") { setSelectedRunId(entityId); setConsoleOpen(true); }
      else if (targetSection === "tasks") {
        const matchingTask = tasks.find((task) => task.id === entityId) ?? null;
        if (matchingTask) { setSelectedTaskId(matchingTask.id); }
        else {
          const matchingRun = runs.find((run) => run.id === entityId) ?? null;
          if (matchingRun) { setSelectedRunId(matchingRun.id); setSelectedTaskId(matchingRun.taskId); setConsoleOpen(true); }
        }
      }
      else if (targetSection === "approvals") setSelectedApprovalId(entityId);
      else if (targetSection === "goals") setSelectedGoalId(entityId);
      else if (targetSection === "projects") setSelectedProjectId(entityId);
      else if (targetSection === "communication") setSelectedCommunicationEntityId(entityId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand setters are stable references
  }, [runs, tasks]);

  useCommandPaletteHotkeys({
    commandPaletteOpen,
    setCommandPaletteOpen,
    setCommandPaletteSearch,
    setSelectedPaletteIndex,
    paletteActions,
    selectedPaletteIndex,
    navigateTo,
    commandPaletteSearch,
  });

  const setCompany = useCallback(async (companyId: string) => {
    if (companyId === "__new__") { setShowOnboarding(true); return; }
    try {
      unwrap(await window.agentCompany.setCurrentCompany(companyId));
      clearCompanyScopedUiState();
      await refresh();
      setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setError and setShowOnboarding are stable Zustand setters
  }, [clearCompanyScopedUiState, refresh]);

  const deleteCompany = useCallback(async (companyId: string) => {
    try {
      unwrap(await window.agentCompany.deleteCompany(companyId));
      setConfirmDeleteCompanyId(null);
      setCompanySwitcherOpen(false);
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand setters are stable references
  }, [refresh]);

  const startRun = useCallback(async (taskId: string) => {
    if (!currentCompany) { setError("Select a company before starting a run."); return; }
    const result = await window.agentCompany.startTaskRun({ companyId: currentCompany.id, taskId });
    if (!result.ok) { setError(result.error.message); return; }
    setSelectedRunId(result.data);
    setConsoleOpen(true);
    await refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand setters are stable references
  }, [currentCompany, refresh]);

  const cancelRun = useCallback(async (runId: string) => {
    try {
      const run = runs.find((entry) => entry.id === runId);
      if (!run) throw new Error("Selected run is no longer available.");
      unwrap(await window.agentCompany.cancelRun({ companyId: run.companyId, runId }));
      await refresh();
      setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setError is a stable Zustand setter
  }, [refresh, runs]);

  const handleOnboardingDone = useCallback(async (summary: OnboardingBootstrapResult) => {
    setShowOnboarding(false);
    setInitialOnboardingLocked(false);
    await refresh();
    setError(null);
    setSection("overview");
    if (summary.runId) setSelectedRunId(summary.runId);
    if (summary.leadAgentId) setSelectedAgentId(summary.leadAgentId);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand setters are stable references
  }, [refresh]);

  const openPathWithFeedback = useCallback(async (path: string) => {
    try { unwrap(await window.agentCompany.openPath(path)); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setError is a stable Zustand setter
  }, []);

  return {
    pageTransition, panelTransition,
    locale, t, handleLocaleChange,
    sidebarNav, navItems, navBadges,
    snapshot, currentCompany,
    showOnboarding, initialOnboardingLocked, handleOnboardingDone, setShowOnboarding, setInitialOnboardingLocked, setError,
    sidebarCollapsed, setSidebarCollapsed,
    companySwitcherOpen, setCompanySwitcherOpen,
    confirmDeleteCompanyId, setConfirmDeleteCompanyId,
    setCompany, deleteCompany,
    section, setSection, error, consoleOpen, setConsoleOpen,
    tasks, runs, approvals, pendingApprovals,
    companyAgents, companyGoals, companyProjects, companyWorkspaces,
    companyCosts, filteredActivity, companySecrets, companyDocuments,
    companyKnowledge, companyMeetings, companySprints,
    socialAccounts, browserActions, inboxItems, companyMetrics, standupReport,
    selectedTask, selectedTaskId, setSelectedTaskId,
    selectedConnector, setSelectedConnectorId,
    selectedApproval, selectedApprovalId, setSelectedApprovalId,
    selectedAgent, selectedAgentId, setSelectedAgentId,
    selectedGoal, selectedGoalId, setSelectedGoalId,
    selectedProject, selectedProjectId, setSelectedProjectId,
    selectedWorkspace, setSelectedWorkspaceId,
    selectedCommunicationEntityId, setSelectedCommunicationEntityId,
    selectedRun, selectedRunId, setSelectedRunId,
    taskViewMode, setTaskViewMode,
    logBufferRef,
    navigateTo, refresh, startRun, cancelRun, openPathWithFeedback,
    commandPaletteOpen, setCommandPaletteOpen,
    commandPaletteSearch, setCommandPaletteSearch,
    selectedPaletteIndex, setSelectedPaletteIndex,
    paletteTrapRef,
    filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects, hasEntityResults,
    paletteActions, paletteActionIndex,
  };
}
