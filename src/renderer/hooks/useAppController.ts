import { useCallback, useMemo } from "react";
import { useAppStore } from "../state/store";
import { useUIController } from "./useUIController";
import { useCompanyController } from "./useCompanyController";
import { useExecutionController } from "./useExecutionController";
import { useOrganizationController } from "./useOrganizationController";
import { useCommunicationController } from "./useCommunicationController";
import { useCommandPaletteHotkeys } from "./useCommandPaletteHotkeys";
import { unwrap } from "../lib/desktop";

// Re-export types consumed by other modules
export type { NavItem, PaletteAction } from "./useUIController";

export function useAppController() {
  const ui = useUIController();
  const company = useCompanyController();
  const execution = useExecutionController();
  const organization = useOrganizationController();
  const communication = useCommunicationController();

  const error = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  const inboxItems = useAppStore((s) => s.inboxItems);
  const companyMetrics = useAppStore((s) => s.companyMetrics);
  const standupReport = useAppStore((s) => s.standupReport);
  const socialAccounts = useAppStore((s) => s.socialAccounts);
  const browserActions = useAppStore((s) => s.browserActions);

  // --- Cross-domain actions composed here ---

  const startRun = useCallback(async (taskId: string) => {
    if (!company.currentCompany) { setError("Select a company before starting a run."); return; }
    const result = await window.agentCompany.startTaskRun({ companyId: company.currentCompany.id, taskId });
    if (!result.ok) { setError(result.error.message); return; }
    execution.setSelectedRunId(result.data);
    ui.setConsoleOpen(true);
    await company.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand setters and company.refresh are stable
  }, [company.currentCompany, company.refresh]);

  const cancelRun = useCallback(async (runId: string) => {
    try {
      const run = company.runs.find((entry) => entry.id === runId);
      if (!run) throw new Error("Selected run is no longer available.");
      unwrap(await window.agentCompany.cancelRun({ companyId: run.companyId, runId }));
      await company.refresh();
      setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setError is a stable Zustand setter
  }, [company.refresh, company.runs]);

  // --- Command palette results (needs entity lists from company domain) ---

  const { filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects, hasEntityResults } =
    useMemo(() => ui.buildPaletteResults(
      ui.navItems,
      company.companyAgents,
      company.tasks,
      company.runs,
      company.companyGoals,
      company.companyProjects,
    ), [
      ui.navItems,
      ui.paletteQuery,
      company.companyAgents,
      company.tasks,
      company.runs,
      company.companyGoals,
      company.companyProjects,
    ]);

  const paletteActions = useMemo(
    () => ui.buildPaletteActions(filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects),
    [filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects],
  );

  const paletteActionIndex = useMemo(
    () => new Map(paletteActions.map((action, index) => [action.key, index])),
    [paletteActions],
  );

  // navigateTo needs entity lists for task/run cross-lookup
  const navigateTo = useCallback((targetSection: Parameters<typeof ui.navigateTo>[0], entityId?: string) => {
    ui.navigateTo(targetSection, entityId, company.runs, company.tasks);
  }, [ui.navigateTo, company.runs, company.tasks]);

  // Wire command palette hotkeys
  useCommandPaletteHotkeys({
    commandPaletteOpen: ui.commandPaletteOpen,
    setCommandPaletteOpen: ui.setCommandPaletteOpen,
    setCommandPaletteSearch: ui.setCommandPaletteSearch,
    setSelectedPaletteIndex: ui.setSelectedPaletteIndex,
    paletteActions,
    selectedPaletteIndex: ui.selectedPaletteIndex,
    navigateTo,
    commandPaletteSearch: ui.commandPaletteSearch,
  });

  return {
    // UI / navigation
    pageTransition: ui.pageTransition,
    panelTransition: ui.panelTransition,
    locale: ui.locale,
    t: ui.t,
    handleLocaleChange: ui.handleLocaleChange,
    sidebarNav: ui.sidebarNav,
    navItems: ui.navItems,
    section: ui.section,
    setSection: ui.setSection,
    consoleOpen: ui.consoleOpen,
    setConsoleOpen: ui.setConsoleOpen,
    sidebarCollapsed: ui.sidebarCollapsed,
    setSidebarCollapsed: ui.setSidebarCollapsed,
    companySwitcherOpen: ui.companySwitcherOpen,
    setCompanySwitcherOpen: ui.setCompanySwitcherOpen,
    confirmDeleteCompanyId: ui.confirmDeleteCompanyId,
    setConfirmDeleteCompanyId: ui.setConfirmDeleteCompanyId,
    taskViewMode: ui.taskViewMode,
    setTaskViewMode: ui.setTaskViewMode,
    showOnboarding: ui.showOnboarding,
    setShowOnboarding: ui.setShowOnboarding,
    initialOnboardingLocked: ui.initialOnboardingLocked,
    setInitialOnboardingLocked: ui.setInitialOnboardingLocked,
    commandPaletteOpen: ui.commandPaletteOpen,
    setCommandPaletteOpen: ui.setCommandPaletteOpen,
    commandPaletteSearch: ui.commandPaletteSearch,
    setCommandPaletteSearch: ui.setCommandPaletteSearch,
    selectedPaletteIndex: ui.selectedPaletteIndex,
    setSelectedPaletteIndex: ui.setSelectedPaletteIndex,
    paletteTrapRef: ui.paletteTrapRef,
    filteredNavItems,
    matchedAgents,
    matchedTasks,
    matchedRuns,
    matchedGoals,
    matchedProjects,
    hasEntityResults,
    paletteActions,
    paletteActionIndex,
    navigateTo,

    // Company / core
    snapshot: company.snapshot,
    currentCompany: company.currentCompany,
    selectedConnector: company.selectedConnector,
    logBufferRef: company.logBufferRef,
    refresh: company.refresh,
    setCompany: company.setCompany,
    deleteCompany: company.deleteCompany,
    handleOnboardingDone: company.handleOnboardingDone,
    openPathWithFeedback: company.openPathWithFeedback,
    tasks: company.tasks,
    runs: company.runs,
    approvals: company.approvals,
    pendingApprovals: company.pendingApprovals,
    companyAgents: company.companyAgents,
    companyGoals: company.companyGoals,
    companyProjects: company.companyProjects,
    companyWorkspaces: company.companyWorkspaces,
    companyCosts: company.companyCosts,
    filteredActivity: company.filteredActivity,
    companySecrets: company.companySecrets,
    companyDocuments: company.companyDocuments,
    companyKnowledge: company.companyKnowledge,
    companyMeetings: company.companyMeetings,
    companySprints: company.companySprints,
    selectedTask: company.selectedTask,
    selectedApproval: company.selectedApproval,
    selectedRun: company.selectedRun,
    selectedAgent: company.selectedAgent,
    selectedGoal: company.selectedGoal,
    selectedProject: company.selectedProject,
    selectedWorkspace: company.selectedWorkspace,
    navBadges: company.navBadges,

    // Execution
    selectedTaskId: execution.selectedTaskId,
    setSelectedTaskId: execution.setSelectedTaskId,
    setSelectedConnectorId: execution.setSelectedConnectorId,
    selectedApprovalId: execution.selectedApprovalId,
    setSelectedApprovalId: execution.setSelectedApprovalId,
    selectedRunId: execution.selectedRunId,
    setSelectedRunId: execution.setSelectedRunId,
    startRun,
    cancelRun,

    // Organization
    selectedAgentId: organization.selectedAgentId,
    setSelectedAgentId: organization.setSelectedAgentId,
    selectedGoalId: organization.selectedGoalId,
    setSelectedGoalId: organization.setSelectedGoalId,
    selectedProjectId: organization.selectedProjectId,
    setSelectedProjectId: organization.setSelectedProjectId,
    setSelectedWorkspaceId: organization.setSelectedWorkspaceId,

    // Communication
    selectedCommunicationEntityId: communication.selectedCommunicationEntityId,
    setSelectedCommunicationEntityId: communication.setSelectedCommunicationEntityId,

    // Shared cross-domain state
    error,
    setError,
    inboxItems,
    companyMetrics,
    standupReport,
    socialAccounts,
    browserActions,
  };
}
