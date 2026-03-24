import { useCallback, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CaretUpDown,
  ChatCircle,
  Check,
  Command,
  Cpu,
  FileText,
  FolderOpen,
  Gear,
  Kanban,
  ListChecks,
  MagnifyingGlass,
  Megaphone,
  Plus,
  UsersThree,
  ShieldCheck,
  Trash,
  UserPlus,
  SquaresFour,
  Target,
  SidebarSimple,
  TerminalWindow,
  CircleNotch,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type {
  CompanyRecord,
  DesktopEvent,
  OnboardingBootstrapResult,
  ProfileSnapshot,
  SectionId,
} from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { createTranslator, LocaleContext, TranslationContext } from "./i18n";
import { useAppStore } from "./state/store";
import { createEventBatcher } from "./lib/ipc-batcher";
import { CompanyOnboarding } from "./components/CompanyOnboarding";
import { Inbox, StandupView, PerformanceView } from "./components/inbox";
import { ConnectorEditor } from "./components/connectors";
import { Dashboard, KanbanBoard } from "./components/dashboard";
import { EntityWorkspace } from "./components/EntityWorkspace";
import { RunCenter } from "./components/runs";
import {
  ActivityList,
  ApprovalInspector,
  ApprovalList,
  BudgetSummary,
  CostList,
  PendingReviewList,
  SecretCreator,
  SettingsPane,
  TaskCreator,
  TaskInspector,
  TaskQueue,
  WorkspaceCreator,
  WorkspaceInspector,
  WorkspaceList,
} from "./components/execution";
import {
  AgentCreator,
  AgentEditor,
  AgentRoster,
  GoalCreator,
  GoalEditor,
  GoalList,
  OrgChart,
  ProjectCreator,
  ProjectEditor,
  ProjectList,
} from "./components/organization";
import { SocialAccountsPanel } from "./components/social";
import { AutomationPanel } from "./components/automation";
import { CommunicationHub } from "./components/communication";
import { HiringPipeline } from "./components/hiring";
import { DocumentCenter, KnowledgeBaseManager, MeetingsManager, SprintManager } from "./components/company-operations";
import { ActionButton, ErrorBoundary, ListFrame, ListRow, Modal, Panel, SectionButton, Select, StatusPill, useFocusTrap, useReducedMotion } from "./components/ui";
import ToastContainer from "./components/Toast";
import { unwrap } from "./lib/desktop";
import { formatMoney, formatTime } from "./lib/formatters";

type NavItemDef = { id: SectionId; labelKey: string; icon: typeof SquaresFour };
type NavItem = { id: SectionId; label: string; icon: typeof SquaresFour };
type PaletteAction = {
  key: string;
  section: SectionId;
  entityId?: string;
};

const sidebarNavDefs: NavItemDef[] = [
  { id: "overview", labelKey: "nav.overview", icon: SquaresFour },
  { id: "agents", labelKey: "nav.agents", icon: UsersThree },
  { id: "tasks", labelKey: "nav.work", icon: ListChecks },
  { id: "communication", labelKey: "nav.communication", icon: ChatCircle },
  { id: "documents", labelKey: "nav.documents", icon: FileText },
  { id: "approvals", labelKey: "nav.approvals", icon: ShieldCheck },
  { id: "social", labelKey: "nav.social", icon: Megaphone },
];

export function App() {
  const reducedMotion = useReducedMotion();
  const noMotion = { duration: 0 };
  const pageTransition = reducedMotion ? noMotion : { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const };
  const panelTransition = reducedMotion ? noMotion : { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const };

  // -- Zustand store bindings (replaces 31 useState calls) --
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const t = useMemo(() => createTranslator(locale), [locale]);

  const sidebarNav: NavItem[] = useMemo(() => sidebarNavDefs.map((item) => ({ id: item.id, label: t(item.labelKey), icon: item.icon })), [t]);
  const navItems: NavItem[] = useMemo(() => sidebarNav.concat({ id: "settings", label: t("nav.settings"), icon: Gear }), [sidebarNav, t]);

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
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const setSelectedWorkspaceId = useAppStore((s) => s.setSelectedWorkspaceId);
  const selectedCommunicationEntityId = useAppStore((s) => s.selectedCommunicationEntityId);
  const setSelectedCommunicationEntityId = useAppStore((s) => s.setSelectedCommunicationEntityId);
  const taskViewMode = useAppStore((s) => s.taskViewMode);
  const setTaskViewMode = useAppStore((s) => s.setTaskViewMode);
  const logBufferRef = useRef<Record<string, string>>({});
  const incrementLogRevision = useAppStore((s) => s.incrementLogRevision);
  const badges = useAppStore((s) => s.badges);
  const setBadges = useAppStore((s) => s.setBadges);
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

  const clearCompanyScopedUiState = useCallback(() => {
    const store = useAppStore.getState();
    store.clearCompanyScopedSelections();
    store.setInboxItems([]);
    store.setCompanyMetrics(null);
    store.setStandupReport(null);
    store.setSocialAccounts([]);
    store.setBrowserActions([]);
    store.setBadges(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = unwrap<ProfileSnapshot>(await window.agentCompany.loadSnapshot());
      setSnapshot(next);
      if (next.companies.length === 0) {
        setInitialOnboardingLocked(true);
      }
      if (!selectedConnectorId && next.connectors[0]) setSelectedConnectorId(next.connectors[0].id);
      if (!selectedRunId && next.runs[0]) setSelectedRunId(next.runs[0].id);
      if (next.currentCompanyId) {
        const badgeResult = await window.agentCompany.getSidebarBadges(next.currentCompanyId);
        if (badgeResult.ok) setBadges(badgeResult.data);
        const inboxResult = await window.agentCompany.getInbox(next.currentCompanyId);
        if (inboxResult.ok) setInboxItems(inboxResult.data);
        setSocialAccounts(next.socialAccounts?.filter(a => a.companyId === next.currentCompanyId) ?? []);
        const browserActionResult = await window.agentCompany.listBrowserActions({ companyId: next.currentCompanyId, limit: 50 });
        if (browserActionResult.ok) {
          setBrowserActions(browserActionResult.data);
        }
      }
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [selectedConnectorId, selectedRunId]);

  const openPathWithFeedback = useCallback(async (path: string) => {
    try {
      unwrap(await window.agentCompany.openPath(path));
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  // Stable ref so the subscribe callback always calls the latest refresh
  // without tearing down the subscription when refresh identity changes.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // IPC event subscription with batcher for coalescing rapid domain-changed events
  useEffect(() => {
    void refreshRef.current();
    const store = useAppStore;
    const batcher = createEventBatcher(() => {
      void refreshRef.current();
    }, 50);

    const unsubscribe = window.agentCompany.subscribe((event: DesktopEvent) => {
      if (event.type === "run-log") {
        // Pass through immediately -- no batching for streaming logs
        const MAX_LOG_BYTES_PER_RUN = 512_000;
        const MAX_TRACKED_RUNS = 50;
        const existing = logBufferRef.current[event.runId] ?? "";
        const updated = existing.length < MAX_LOG_BYTES_PER_RUN
          ? existing + event.chunk
          : existing.slice(-MAX_LOG_BYTES_PER_RUN / 2) + event.chunk;
        logBufferRef.current[event.runId] = updated;
        const runIds = Object.keys(logBufferRef.current);
        if (runIds.length > MAX_TRACKED_RUNS) {
          for (const oldId of runIds.slice(0, runIds.length - MAX_TRACKED_RUNS)) {
            delete logBufferRef.current[oldId];
          }
        }
        incrementLogRevision();
        return;
      }
      if (event.type === "shortcut") {
        if (event.action === "toggle-command-palette") store.getState().toggleCommandPalette();
        if (event.action === "toggle-console") store.getState().toggleConsole();
        if (event.action === "refresh") void refreshRef.current();
        return;
      }
      if (event.type === "notification-click") {
        store.getState().navigateTo(event.section, event.entityId);
        return;
      }
      // All data-mutating events: batch the snapshot reload
      batcher.schedule();
    });
    return () => {
      unsubscribe();
      batcher.dispose();
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const root = document.documentElement;
    root.dataset.theme = snapshot.theme;
    root.style.colorScheme = snapshot.theme === "system" ? "light dark" : snapshot.theme;
    if (snapshot.locale && snapshot.locale !== locale) {
      setLocale(snapshot.locale);
    }
  }, [snapshot, locale]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const handleLocaleChange = useCallback(async (newLocale: AppLocale) => {
    setLocale(newLocale);
    try {
      await window.agentCompany.updateSettings({ locale: newLocale });
    } catch {
      // persist failed; local state is already updated
    }
  }, []);

  useEffect(() => {
    if (!snapshot?.currentCompanyId) return;
    const companyId = snapshot.currentCompanyId;
    let cancelled = false;

    if (section === "inbox") {
      void window.agentCompany.getInbox(companyId).then((result) => {
        if (!cancelled && result.ok) setInboxItems(result.data);
      });
    }

    if (section === "performance") {
      void window.agentCompany.getCompanyMetrics({ companyId, days: 30 }).then((result) => {
        if (!cancelled && result.ok) setCompanyMetrics(result.data);
      });
    }

    if (section === "standup") {
      void window.agentCompany.getStandupReport(companyId).then((result) => {
        if (!cancelled && result.ok) setStandupReport(result.data);
      });
    }

    if (section === "social") {
      setSocialAccounts(snapshot.socialAccounts?.filter((a) => a.companyId === companyId) ?? []);
    }

    return () => {
      cancelled = true;
    };
  }, [section, snapshot]);

  const paletteTrapRef = useFocusTrap(commandPaletteOpen);

  const currentCompany = useMemo<CompanyRecord | null>(() => {
    if (!snapshot) return null;
    return snapshot.companies.find((company) => company.id === snapshot.currentCompanyId) ?? snapshot.companies[0] ?? null;
  }, [snapshot]);

  const tasks = useMemo(() => snapshot?.tasks.filter((task) => !currentCompany || task.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const selectedTask = selectedTaskId ? (tasks.find((task) => task.id === selectedTaskId) ?? null) : null;
  const selectedConnector = snapshot?.connectors.find((connector) => connector.id === selectedConnectorId) ?? snapshot?.connectors[0] ?? null;
  const approvals = useMemo(() => snapshot?.approvals.filter((approval) => !currentCompany || approval.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.state === "pending"), [approvals]);
  const selectedApproval = selectedApprovalId ? (approvals.find((approval) => approval.id === selectedApprovalId) ?? null) : null;
  const runs = useMemo(() => snapshot?.runs.filter((run) => !currentCompany || run.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  useEffect(() => {
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id ?? null);
    }
  }, [runs, selectedRunId]);

  const activeRunId = selectedRun?.id ?? null;

  useEffect(() => {
    if (!activeRunId) return;
    void (async () => {
      const activeRun = runs.find((run) => run.id === activeRunId);
      if (!activeRun) {
        return;
      }
      const result = await window.agentCompany.getRunLog({ companyId: activeRun.companyId, runId: activeRunId });
      if (result.ok) {
        logBufferRef.current = { ...logBufferRef.current, [activeRunId]: result.data };
        incrementLogRevision();
        return;
      }
      setError(result.error.message);
    })();
  }, [activeRunId, runs]);

  const companyAgents = useMemo(() => snapshot?.agents.filter((a) => !currentCompany || a.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const selectedAgent = companyAgents.find((a) => a.id === selectedAgentId) ?? null;
  const companyGoals = useMemo(() => snapshot?.goals.filter((g) => !currentCompany || g.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const selectedGoal = companyGoals.find((g) => g.id === selectedGoalId) ?? null;
  const companyProjects = useMemo(() => snapshot?.projects.filter((p) => !currentCompany || p.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const selectedProject = companyProjects.find((p) => p.id === selectedProjectId) ?? null;

  const activeInboxCount = inboxItems.length;
  const navBadges = useMemo<Partial<Record<SectionId, { count: number; tone: "default" | "warn" | "danger" }>>>(() => badges ? {
    runs:
      badges.failedRuns > 0
        ? { count: badges.failedRuns, tone: "danger" }
        : badges.activeRuns > 0
          ? { count: badges.activeRuns, tone: "default" }
          : undefined,
    tasks: badges.todoTasks > 0 ? { count: badges.todoTasks, tone: "default" } : undefined,
    approvals: badges.pendingApprovals > 0 ? { count: badges.pendingApprovals, tone: "warn" } : undefined,
    communication: badges.unreadMessages > 0 ? { count: badges.unreadMessages, tone: "warn" } : undefined,
  } : {}, [badges, activeInboxCount]);

  const companyWorkspaces = useMemo(() => snapshot?.workspaces.filter((workspace) => !currentCompany || workspace.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const selectedWorkspace = companyWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? companyWorkspaces[0] ?? null;
  const companyCosts = useMemo(() => snapshot?.costs.filter((entry) => !currentCompany || entry.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const filteredActivity = useMemo(() => snapshot?.activity.filter((entry) => !currentCompany || entry.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companySecrets = useMemo(() => snapshot?.secrets.filter((secret) => !currentCompany || secret.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companyDocuments = useMemo(() => snapshot?.documents?.filter((d) => !currentCompany || d.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companyKnowledge = useMemo(() => snapshot?.knowledgeBase?.filter((k) => !currentCompany || k.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companyMeetings = useMemo(() => snapshot?.meetings?.filter((m) => !currentCompany || m.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companySprints = useMemo(() => snapshot?.sprints?.filter((s) => !currentCompany || s.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const paletteQuery = commandPaletteSearch.trim().toLowerCase();
  const paletteResults = useMemo(() => {
    const filteredNavItems = paletteQuery
      ? navItems.filter((item) => item.label.toLowerCase().includes(paletteQuery) || item.id.toLowerCase().includes(paletteQuery))
      : navItems;
    const matchedAgents = paletteQuery ? companyAgents.filter((a) => a.name.toLowerCase().includes(paletteQuery) || a.role.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const matchedTasks = paletteQuery ? tasks.filter((t) => t.title.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const matchedRuns = paletteQuery ? runs.filter((run) => {
      const matchingTask = tasks.find((task) => task.id === run.taskId);
      return [
        run.id,
        run.summary ?? "",
        run.errorMessage ?? "",
        matchingTask?.title ?? "",
        run.connectorId,
      ].some((value) => value.toLowerCase().includes(paletteQuery));
    }).slice(0, 5) : [];
    const matchedGoals = paletteQuery ? companyGoals.filter((g) => g.title.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const matchedProjects = paletteQuery ? companyProjects.filter((p) => p.name.toLowerCase().includes(paletteQuery)).slice(0, 5) : [];
    const hasEntityResults = matchedAgents.length > 0 || matchedTasks.length > 0 || matchedRuns.length > 0 || matchedGoals.length > 0 || matchedProjects.length > 0;
    return { filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects, hasEntityResults };
  }, [paletteQuery, companyAgents, companyGoals, companyProjects, runs, tasks]);
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
      else if (targetSection === "runs") {
        setSelectedRunId(entityId);
        setConsoleOpen(true);
      }
      else if (targetSection === "tasks") {
        const matchingTask = tasks.find((task) => task.id === entityId) ?? null;
        if (matchingTask) {
          setSelectedTaskId(matchingTask.id);
        } else {
          const matchingRun = runs.find((run) => run.id === entityId) ?? null;
          if (matchingRun) {
            setSelectedRunId(matchingRun.id);
            setSelectedTaskId(matchingRun.taskId);
            setConsoleOpen(true);
          }
        }
      }
      else if (targetSection === "approvals") setSelectedApprovalId(entityId);
      else if (targetSection === "goals") setSelectedGoalId(entityId);
      else if (targetSection === "projects") setSelectedProjectId(entityId);
      else if (targetSection === "communication") setSelectedCommunicationEntityId(entityId);
    }
  }, [runs, tasks]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
        setCommandPaletteSearch("");
        setSelectedPaletteIndex(0);
        return;
      }
      if (paletteActions.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedPaletteIndex((useAppStore.getState().selectedPaletteIndex + 1) % paletteActions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedPaletteIndex((useAppStore.getState().selectedPaletteIndex - 1 + paletteActions.length) % paletteActions.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const selectedAction = paletteActions[Math.min(selectedPaletteIndex, paletteActions.length - 1)];
        if (!selectedAction) return;
        navigateTo(selectedAction.section, selectedAction.entityId);
        setCommandPaletteOpen(false);
        setCommandPaletteSearch("");
        setSelectedPaletteIndex(0);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [commandPaletteOpen, navigateTo, paletteActions, selectedPaletteIndex]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    setSelectedPaletteIndex(0);
  }, [commandPaletteOpen, commandPaletteSearch]);

  const setCompany = useCallback(async (companyId: string) => {
    if (companyId === "__new__") {
      setShowOnboarding(true);
      return;
    }
    try {
      unwrap(await window.agentCompany.setCurrentCompany(companyId));
      clearCompanyScopedUiState();
      await refresh();
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [clearCompanyScopedUiState, refresh]);

  const deleteCompany = useCallback(async (companyId: string) => {
    try {
      unwrap(await window.agentCompany.deleteCompany(companyId));
      setConfirmDeleteCompanyId(null);
      setCompanySwitcherOpen(false);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [refresh]);

  const startRun = useCallback(async (taskId: string) => {
    if (!currentCompany) {
      setError("Select a company before starting a run.");
      return;
    }
    const result = await window.agentCompany.startTaskRun({ companyId: currentCompany.id, taskId });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSelectedRunId(result.data);
    setConsoleOpen(true);
    await refresh();
  }, [currentCompany, refresh]);

  const cancelRun = useCallback(async (runId: string) => {
    try {
      const run = runs.find((entry) => entry.id === runId);
      if (!run) {
        throw new Error("Selected run is no longer available.");
      }
      unwrap(await window.agentCompany.cancelRun({ companyId: run.companyId, runId }));
      await refresh();
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [refresh, runs]);

  const handleOnboardingDone = useCallback(async (summary: OnboardingBootstrapResult) => {
    setShowOnboarding(false);
    setInitialOnboardingLocked(false);
    await refresh();
    setError(null);
    setSection("overview");
    if (summary.runId) {
      setSelectedRunId(summary.runId);
    }
    if (summary.leadAgentId) {
      setSelectedAgentId(summary.leadAgentId);
    }
  }, [refresh]);

  if (!snapshot) {
    return (
      <LocaleContext.Provider value={locale}>
        <TranslationContext.Provider value={t}>
          <div className="flex min-h-screen flex-col items-center justify-center gap-3">
            <CircleNotch size={24} className="animate-spin text-[color:var(--accent)]" />
            <span className="text-[13px] text-[color:var(--muted)]">{t("app.loading")}</span>
          </div>
        </TranslationContext.Provider>
      </LocaleContext.Provider>
    );
  }

  if (snapshot.companies.length === 0 || showOnboarding || initialOnboardingLocked) {
    return (
      <LocaleContext.Provider value={locale}>
        <TranslationContext.Provider value={t}>
          <CompanyOnboarding
            connectors={snapshot.connectors}
            onDone={handleOnboardingDone}
            canCancel={snapshot.companies.length > 0 && !initialOnboardingLocked}
            onCancel={() => {
              setShowOnboarding(false);
              setInitialOnboardingLocked(false);
              setError(null);
            }}
            currentLocale={locale}
            onLocaleChange={handleLocaleChange}
            isFirstLaunch={snapshot.companies.length === 0}
          />
        </TranslationContext.Provider>
      </LocaleContext.Provider>
    );
  }

  return (
    <LocaleContext.Provider value={locale}>
    <TranslationContext.Provider value={t}>
    <div className={`grid h-[100dvh] overflow-hidden bg-[color:var(--bg)] ${sidebarCollapsed ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[220px_minmax(0,1fr)]"}`}>
      <aside className="flex h-[100dvh] flex-col overflow-hidden border-r border-[color:var(--line-strong)] bg-[color:var(--panel)]">
        {sidebarCollapsed ? (
          <div className="sidebar-drag flex items-center justify-center px-2 pb-3 pt-[38px]">
            <button
              aria-label="Open command palette"
              title="Command palette"
              className="focus-ring flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] border border-[color:var(--line)] text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
              onClick={() => setCommandPaletteOpen(true)}
            >
              <Command size={14} />
            </button>
          </div>
        ) : (
          <div className="sidebar-drag flex items-center gap-2.5 px-4 pb-4 pt-[38px]">
            <div className="relative min-w-0 flex-1">
              <button
                type="button"
                className="focus-ring flex w-full items-center gap-2 rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel)] px-2.5 py-1.5 text-left text-[13px] font-medium text-[color:var(--text)] transition hover:bg-[color:var(--panel-soft)]"
                onClick={() => setCompanySwitcherOpen(!companySwitcherOpen)}
              >
                <span className="min-w-0 flex-1 truncate">{currentCompany?.name ?? t("app.selectCompany")}</span>
                <CaretUpDown size={14} className="shrink-0 text-[color:var(--muted)]" />
              </button>
              {companySwitcherOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => { setCompanySwitcherOpen(false); setConfirmDeleteCompanyId(null); }} />
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] shadow-lg">
                    <div className="max-h-[240px] overflow-y-auto py-1">
                      {snapshot.companies.map((company) => (
                        <div key={company.id} className="group flex items-center">
                          {confirmDeleteCompanyId === company.id ? (
                            <div className="flex w-full items-center gap-2 px-3 py-2">
                              <span className="flex-1 truncate text-[12px] text-[color:var(--danger)]">Delete {company.name}?</span>
                              <button
                                type="button"
                                className="rounded px-2 py-0.5 text-[11px] font-semibold text-[color:var(--danger)] transition hover:bg-[color:var(--danger)] hover:text-[color:var(--text-on-accent)]"
                                onClick={() => void deleteCompany(company.id)}
                              >
                                Yes
                              </button>
                              <button
                                type="button"
                                className="rounded px-2 py-0.5 text-[11px] font-semibold text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)]"
                                onClick={() => setConfirmDeleteCompanyId(null)}
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                className={`flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-[13px] transition hover:bg-[color:var(--panel-soft)] ${
                                  company.id === currentCompany?.id ? "font-semibold text-[color:var(--text)]" : "text-[color:var(--muted-strong)]"
                                }`}
                                onClick={() => { void setCompany(company.id); setCompanySwitcherOpen(false); }}
                              >
                                <span className="w-4 shrink-0">{company.id === currentCompany?.id ? <Check size={14} weight="bold" className="text-[color:var(--accent)]" /> : null}</span>
                                <span className="min-w-0 flex-1 truncate">{company.name}</span>
                              </button>
                              <button
                                type="button"
                                className="mr-2 rounded p-1 text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--danger)] hover:text-[color:var(--text-on-accent)] group-hover:opacity-100"
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
                    <div className="border-t border-[color:var(--line)]">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[color:var(--muted-strong)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
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
              aria-label="Open command palette"
              className="focus-ring flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] border border-[color:var(--line)] text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
              onClick={() => setCommandPaletteOpen(true)}
            >
              <Command size={14} />
            </button>
          </div>
        )}
        <nav aria-label="Main navigation" className={`flex-1 overflow-y-auto pb-3 ${sidebarCollapsed ? "px-1.5 pt-2" : "px-3 pt-2"}`}>
          <div className="space-y-0.5">
            {sidebarNav.map((item) => (
              <SectionButton
                key={item.id}
                active={section === item.id}
                label={item.label}
                icon={item.icon}
                onClick={() => setSection(item.id)}
                badge={navBadges[item.id]?.count}
                badgeTone={navBadges[item.id]?.tone}
                collapsed={sidebarCollapsed}
              />
            ))}
          </div>
        </nav>
        <div className={`border-t border-[color:var(--line)] py-2 ${sidebarCollapsed ? "px-1.5" : "px-3"}`}>
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
            className={`focus-ring mt-1 flex w-full items-center rounded-[6px] py-[7px] text-[color:var(--muted)] transition duration-150 hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)] ${sidebarCollapsed ? "justify-center p-2" : "gap-2.5 px-3"}`}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <SidebarSimple size={sidebarCollapsed ? 18 : 17} />
            {!sidebarCollapsed ? <span className="text-[13px] font-medium tracking-[0.005em]">{t("app.collapse")}</span> : null}
          </button>
        </div>
      </aside>

      <main aria-label="Content" className="flex min-w-0 flex-col overflow-hidden">
        <header className="sidebar-drag shrink-0 border-b border-[color:var(--line)] bg-[color:var(--bg)]">
          <div className="mx-auto flex w-full max-w-[1040px] items-start justify-between gap-4 px-6 pb-5 pt-6 lg:gap-6 lg:px-10 lg:pt-8">
            <h1 className="text-[28px] font-bold tracking-[-0.02em] text-[color:var(--text)]">
              {navItems.find((item) => item.id === section)?.label ?? t(`nav.${section}`)}
            </h1>
            <div className="flex shrink-0 items-center gap-3 lg:gap-5">
              <button
                type="button"
                aria-label={consoleOpen ? "Hide console" : "Show console"}
                title={consoleOpen ? "Hide console" : "Show console"}
                className="focus-ring inline-flex items-center gap-2 py-1 text-[12px] font-semibold text-[color:var(--muted-strong)] transition hover:text-[color:var(--text)]"
                onClick={() => setConsoleOpen(!consoleOpen)}
              >
                <TerminalWindow size={16} />
                <span className="hidden lg:inline">{consoleOpen ? t("app.hideConsole") : t("app.showConsole")}</span>
              </button>
            </div>
          </div>
        </header>

        <div className={`flex-1 ${section === "communication" ? "flex flex-col overflow-hidden" : "overflow-auto"}`}>
        <div className={section === "communication" ? "flex min-h-0 flex-1 flex-col" : "mx-auto flex w-full max-w-[1040px] flex-col px-6 py-6 lg:px-10 lg:py-8"}>

        {error ? (
          <div className={`flex items-center gap-3 rounded-[8px] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)] ${section === "communication" ? "mx-6 mt-4" : "mb-6"}`}>
            <WarningCircle size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className={section === "communication" ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1"}>
          <ErrorBoundary>
            <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={pageTransition}
              className={section === "communication" ? "flex min-h-0 flex-1 flex-col" : "space-y-14"}
              style={section === "communication" ? { height: "100%" } : undefined}
            >
              {section === "overview" ? (
                <Dashboard
                  companyName={currentCompany?.name}
                  agents={companyAgents}
                  tasks={tasks}
                  runs={runs}
                  approvals={approvals}
                  goals={companyGoals}
                  projects={companyProjects}
                  activity={filteredActivity}
                  costs={companyCosts}
                  messages={snapshot.agentMessages?.filter((message) => !currentCompany || message.companyId === currentCompany.id) ?? []}
                  onNavigate={navigateTo}
                />
              ) : null}

              {section === "inbox" ? (
                <Inbox
                  items={inboxItems}
                  onNavigate={navigateTo}
                />
              ) : null}

              {section === "standup" ? (
                <StandupView
                  report={standupReport}
                  onNavigate={navigateTo}
                />
              ) : null}

              {section === "performance" ? (
                <PerformanceView
                  metrics={companyMetrics}
                  onNavigate={navigateTo}
                />
              ) : null}

              {section === "runs" ? (
                <RunCenter
                  runs={runs}
                  tasks={tasks}
                  agents={companyAgents}
                  workspaces={companyWorkspaces}
                  selectedRunId={selectedRun?.id ?? null}
                  onSelectRun={(runId: string) => {
                    setSelectedRunId(runId);
                  }}
                  onOpenLogPath={async (path: string) => {
                    await openPathWithFeedback(path);
                  }}
                  onCancelRun={cancelRun}
                  onOpenConsole={(runId: string) => {
                    setSelectedRunId(runId);
                    setConsoleOpen(true);
                  }}
                />
              ) : null}

              {section === "connectors" && selectedConnector ? (
                <div className="space-y-10">
                  <Panel title="Connector registry">
                    <ListFrame>
                      {snapshot.connectors.map((connector) => (
                        <ListRow
                          key={connector.id}
                          onClick={() => setSelectedConnectorId(connector.id)}
                          className={`cursor-pointer transition-colors duration-100 ${
                            selectedConnector.id === connector.id
                              ? "bg-[color:var(--accent-soft)]"
                              : "hover:bg-[color:var(--panel-soft)]"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <div className="text-[14px] font-medium text-[color:var(--text)]">{connector.label}</div>
                              <div className="mt-1 truncate text-[11px] uppercase tracking-[0.12em] text-[color:var(--muted)]">{connector.command}</div>
                            </div>
                            <StatusPill status={connector.status} />
                          </div>
                        </ListRow>
                      ))}
                    </ListFrame>
                  </Panel>
                  <Panel
                    title={selectedConnector.label}
                  >
                    <ConnectorEditor connector={selectedConnector} onSaved={refresh} />
                  </Panel>
                </div>
              ) : null}

              {section === "agents" ? (
                <>
                  <OrgChart agents={companyAgents} onSelectAgent={(id) => setSelectedAgentId(id)} />
                  <Panel title="Agent roster" action={<ActionButton label="New hire request" icon={UserPlus} tone="accent" onClick={() => setSelectedAgentId("__new__")} />}>
                    <AgentRoster
                      agents={companyAgents}
                      connectors={snapshot.connectors}
                      workspaces={companyWorkspaces}
                      selectedAgentId={selectedAgentId}
                      onSelect={setSelectedAgentId}
                    />
                  </Panel>
                  <Modal open={selectedAgentId === "__new__"} title="Request new hire" onClose={() => setSelectedAgentId(null)}>
                    <AgentCreator
                      companyId={currentCompany!.id}
                      connectors={snapshot.connectors}
                      workspaces={companyWorkspaces}
                      agents={companyAgents}
                      onSaved={async () => {
                        setSelectedAgentId(null);
                        setSection("hiring");
                        await refresh();
                      }}
                    />
                  </Modal>
                  <Modal open={!!selectedAgent} title={selectedAgent ? `Edit: ${selectedAgent.name}` : ""} onClose={() => setSelectedAgentId(null)}>
                    {selectedAgent ? (
                      <AgentEditor
                        key={selectedAgentId}
                        agent={selectedAgent}
                        connectors={snapshot.connectors}
                        workspaces={companyWorkspaces}
                        agents={companyAgents}
                        companyId={currentCompany!.id}
                        onSaved={refresh}
                        onDeleted={async () => { setSelectedAgentId(null); await refresh(); }}
                      />
                    ) : null}
                  </Modal>
                </>
              ) : null}

              {section === "orgchart" ? (
                <OrgChart agents={companyAgents} onSelectAgent={(id) => { setSelectedAgentId(id); setSection("agents"); }} />
              ) : null}

              {section === "hiring" && currentCompany ? (
                <HiringPipeline
                  agents={companyAgents}
                  approvals={(snapshot?.approvals ?? []).filter(a => a.companyId === currentCompany!.id)}
                  onRefresh={refresh}
                  onNavigateToAgent={(id) => { setSelectedAgentId(id); setSection("agents"); }}
                />
              ) : null}

              {section === "goals" ? (
                <>
                  <Panel title="Goal stack" action={<ActionButton label="New goal" icon={Target} tone="accent" onClick={() => setSelectedGoalId("__new__")} />}>
                    <GoalList goals={companyGoals} agents={companyAgents} selectedGoalId={selectedGoalId} onSelect={setSelectedGoalId} />
                  </Panel>
                  <Modal open={selectedGoalId === "__new__"} title="New goal" onClose={() => setSelectedGoalId(null)}>
                    <GoalCreator companyId={currentCompany!.id} agents={companyAgents} goals={companyGoals} onSaved={async () => { setSelectedGoalId(null); await refresh(); }} />
                  </Modal>
                  <Modal open={!!selectedGoal} title={selectedGoal ? `Edit: ${selectedGoal.title}` : ""} onClose={() => setSelectedGoalId(null)}>
                    {selectedGoal ? (
                      <GoalEditor
                        key={selectedGoalId}
                        goal={selectedGoal}
                        goals={companyGoals}
                        agents={companyAgents}
                        companyId={currentCompany!.id}
                        onSaved={async () => { setSelectedGoalId(null); await refresh(); }}
                        onDeleted={async () => { setSelectedGoalId(null); await refresh(); }}
                      />
                    ) : null}
                  </Modal>
                </>
              ) : null}

              {section === "projects" ? (
                <>
                  <Panel title="Projects" action={<ActionButton label="New project" icon={Kanban} tone="accent" onClick={() => setSelectedProjectId("__new__")} />}>
                    <ProjectList projects={companyProjects} goals={companyGoals} agents={companyAgents} workspaces={companyWorkspaces} selectedProjectId={selectedProjectId} onSelect={setSelectedProjectId} />
                  </Panel>
                  <Modal open={selectedProjectId === "__new__"} title="New project" onClose={() => setSelectedProjectId(null)}>
                    <ProjectCreator companyId={currentCompany!.id} goals={companyGoals} agents={companyAgents} onSaved={async () => { setSelectedProjectId(null); await refresh(); }} />
                  </Modal>
                  <Modal open={!!selectedProject} title={selectedProject ? `Edit: ${selectedProject.name}` : ""} onClose={() => setSelectedProjectId(null)}>
                    {selectedProject ? (
                      <ProjectEditor
                        key={selectedProjectId}
                        project={selectedProject}
                        goals={companyGoals}
                        agents={companyAgents}
                        companyId={currentCompany!.id}
                        onSaved={async () => { setSelectedProjectId(null); await refresh(); }}
                        onDeleted={async () => { setSelectedProjectId(null); await refresh(); }}
                      />
                    ) : null}
                  </Modal>
                </>
              ) : null}

              {section === "tasks" ? (
                <>
                  <Panel title="Goals" action={<ActionButton label="New goal" icon={Target} tone="accent" onClick={() => setSelectedGoalId("__new__")} />}>
                    <GoalList goals={companyGoals} agents={companyAgents} selectedGoalId={selectedGoalId} onSelect={setSelectedGoalId} />
                  </Panel>
                  <Modal open={selectedGoalId === "__new__" && section === "tasks"} title="New goal" onClose={() => setSelectedGoalId(null)}>
                    <GoalCreator companyId={currentCompany!.id} agents={companyAgents} goals={companyGoals} onSaved={async () => { setSelectedGoalId(null); await refresh(); }} />
                  </Modal>
                  <Modal open={!!selectedGoal && section === "tasks"} title={selectedGoal ? `Edit: ${selectedGoal.title}` : ""} onClose={() => setSelectedGoalId(null)}>
                    {selectedGoal ? (
                      <GoalEditor
                        key={selectedGoalId}
                        goal={selectedGoal}
                        goals={companyGoals}
                        agents={companyAgents}
                        companyId={currentCompany!.id}
                        onSaved={async () => { setSelectedGoalId(null); await refresh(); }}
                        onDeleted={async () => { setSelectedGoalId(null); await refresh(); }}
                      />
                    ) : null}
                  </Modal>

                  <Panel
                    title="Task queue"
                    action={
                      <div className="flex items-center gap-2">
                        <div className="flex rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel)]">
                          <button
                            type="button"
                            onClick={() => setTaskViewMode("list")}
                            className={`px-2.5 py-1.5 text-[11px] font-medium transition ${taskViewMode === "list" ? "bg-[color:var(--panel-soft)] text-[color:var(--text)]" : "text-[color:var(--muted)] hover:text-[color:var(--text)]"}`}
                          >
                            <ListChecks size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setTaskViewMode("kanban")}
                            className={`px-2.5 py-1.5 text-[11px] font-medium transition ${taskViewMode === "kanban" ? "bg-[color:var(--panel-soft)] text-[color:var(--text)]" : "text-[color:var(--muted)] hover:text-[color:var(--text)]"}`}
                          >
                            <Kanban size={14} />
                          </button>
                        </div>
                        <ActionButton label="New task" icon={ListChecks} tone="accent" onClick={() => setSelectedTaskId("__new__")} />
                      </div>
                    }
                  >
                    {taskViewMode === "kanban" ? (
                      <KanbanBoard tasks={tasks} agents={companyAgents} runs={runs} onSelectTask={setSelectedTaskId} />
                    ) : (
                      <TaskQueue tasks={tasks} runs={runs} onSelect={setSelectedTaskId} selectedTaskId={selectedTask?.id ?? null} />
                    )}
                  </Panel>
                  <Modal open={selectedTaskId === "__new__"} title="New task" onClose={() => setSelectedTaskId(null)}>
                    <TaskCreator companyId={currentCompany!.id} goals={companyGoals} projects={companyProjects} agents={companyAgents} workspaces={companyWorkspaces} onSaved={async () => { setSelectedTaskId(null); await refresh(); }} />
                  </Modal>
                  <Modal open={!!selectedTask} title={selectedTask?.title ?? ""} onClose={() => setSelectedTaskId(null)} width="720px">
                    {selectedTask ? (
                      <TaskInspector
                        task={selectedTask}
                        tasks={tasks}
                        runs={runs.filter((run) => run.taskId === selectedTask.id)}
                        agents={companyAgents}
                        goals={companyGoals}
                        projects={companyProjects}
                        workspaces={companyWorkspaces}
                        companyId={currentCompany!.id}
                        comments={(snapshot.comments ?? []).filter((comment) => comment.taskId === selectedTask.id)}
                        onRefresh={refresh}
                        onRun={startRun}
                        onCancelRun={cancelRun}
                        onCreateApproval={async () => {
                          const isBlocked = selectedTask.status === "blocked";
                          const approvalId = unwrap(await window.agentCompany.requestApproval({
                            companyId: currentCompany!.id,
                            relatedTaskId: selectedTask.id,
                            requestedByAgentId: selectedTask.assigneeAgentId,
                            type: isBlocked ? "secret_access" : "approve_ceo_strategy",
                            payloadSummary: isBlocked
                              ? `Blocker: ${selectedTask.title} — needs operator assistance`
                              : `Review needed: ${selectedTask.title}`,
                            impactSummary: isBlocked
                              ? "Agent is blocked and needs operator input (credentials, access, or decision)."
                              : "No automated reviewer available. Operator review required.",
                          }));
                          setSelectedApprovalId(approvalId);
                          await refresh();
                        }}
                        onOpenDiscussion={(taskId) => {
                          setSelectedTaskId(null);
                          setSection("communication");
                          setSelectedCommunicationEntityId(taskId);
                        }}
                        onDeleted={async () => { setSelectedTaskId(null); await refresh(); }}
                      />
                    ) : null}
                  </Modal>
                </>
              ) : null}

              {section === "approvals" ? (
                <>
                  <Panel title="Agent reviews in progress">
                    <PendingReviewList tasks={tasks} agents={companyAgents} />
                  </Panel>
                  <Panel title="Pending approvals">
                    <ApprovalList approvals={pendingApprovals} selectedApprovalId={selectedApproval?.id ?? null} onSelect={setSelectedApprovalId} />
                  </Panel>
                  <Modal open={!!selectedApproval} title={selectedApproval?.payloadSummary ?? "Approval detail"} onClose={() => setSelectedApprovalId(null)}>
                    {selectedApproval ? (
                      <ApprovalInspector
                        approval={selectedApproval}
                        agents={companyAgents}
                        tasks={tasks}
                        documents={companyDocuments}
                        companyId={currentCompany!.id}
                        onDecide={async (state, note) => {
                          unwrap(await window.agentCompany.decideApproval({ companyId: currentCompany!.id, approvalId: selectedApproval.id, state, decisionNote: note ?? `${state} from desktop control surface.` }));
                          await refresh();
                        }}
                        onDeleted={async () => { setSelectedApprovalId(null); await refresh(); }}
                      />
                    ) : null}
                  </Modal>
                </>
              ) : null}

              {section === "costs" ? (
                <EntityWorkspace
                  title="Costs"
                  eyebrow={undefined}
                  primary={
                    <Panel title="Recent cost entries">
                      <CostList costs={companyCosts} agents={companyAgents} runs={runs} />
                    </Panel>
                  }
                  secondary={
                    <Panel title="Budget posture">
                      <BudgetSummary agents={companyAgents} costs={companyCosts} />
                    </Panel>
                  }
                />
              ) : null}

              {section === "activity" ? (
                <Panel title="Activity timeline">
                  <ActivityList activity={filteredActivity} />
                </Panel>
              ) : null}

              {section === "social" && snapshot?.currentCompanyId && (
                <SocialAccountsPanel
                  accounts={socialAccounts}
                  actions={browserActions}
                  agents={companyAgents.map(a => ({ id: a.id, name: a.name }))}
                  companyId={snapshot.currentCompanyId}
                  onSave={async (input) => {
                    try {
                      unwrap(await window.agentCompany.saveSocialAccount({
                        companyId: input.companyId,
                        platform: input.platform,
                        accountName: input.accountName,
                        displayName: input.displayName,
                        requireApproval: input.requireApproval,
                        profileUrl: "",
                        status: "login_required",
                        metadataJson: "{}",
                      }));
                      await refresh();
                      setError(null);
                    } catch (error) {
                      setError(error instanceof Error ? error.message : String(error));
                    }
                  }}
                  onDelete={async (id) => {
                    if (!snapshot?.currentCompanyId) return;
                    try {
                      unwrap(await window.agentCompany.deleteSocialAccount({ id, companyId: snapshot.currentCompanyId }));
                      await refresh();
                      setError(null);
                    } catch (error) {
                      setError(error instanceof Error ? error.message : String(error));
                    }
                  }}
                  onLogin={async (accountId) => {
                    if (!snapshot?.currentCompanyId) return;
                    try {
                      unwrap(await window.agentCompany.triggerBrowserLogin({ companyId: snapshot.currentCompanyId, socialAccountId: accountId }));
                      await refresh();
                      setError(null);
                    } catch (error) {
                      setError(error instanceof Error ? error.message : String(error));
                    }
                  }}
                  onOpenPath={async (path) => {
                    try {
                      unwrap(await window.agentCompany.openPath(path));
                      setError(null);
                    } catch (error) {
                      setError(error instanceof Error ? error.message : String(error));
                    }
                  }}
                  onCancelAction={async (actionId) => {
                    if (!snapshot?.currentCompanyId) return;
                    try {
                      unwrap(await window.agentCompany.cancelBrowserAction({ actionId, companyId: snapshot.currentCompanyId }));
                      await refresh();
                      setError(null);
                    } catch (error) {
                      setError(error instanceof Error ? error.message : String(error));
                    }
                  }}
                  onNavigate={(sectionName, entityId) => {
                    setSection(sectionName);
                    if (sectionName === "tasks") setSelectedTaskId(entityId);
                    if (sectionName === "approvals") setSelectedApprovalId(entityId);
                  }}
                />
              )}

              {section === "automation" && currentCompany ? (
                <AutomationPanel
                  key={currentCompany.id}
                  rules={snapshot.automationRules?.filter(r => r.companyId === currentCompany.id) ?? []}
                  workflows={snapshot.workflows?.filter(w => w.companyId === currentCompany.id) ?? []}
                  companyId={currentCompany.id}
                  onRefresh={refresh}
                />
              ) : null}

              {section === "communication" && currentCompany ? (
                <CommunicationHub
                  messages={snapshot.agentMessages?.filter(m => m.companyId === currentCompany.id) ?? []}
                  comments={snapshot.comments?.filter((comment) => comment.companyId === currentCompany.id) ?? []}
                  tasks={tasks}
                  agents={companyAgents}
                  projects={companyProjects}
                  companyId={currentCompany.id}
                  selectedEntityId={selectedCommunicationEntityId}
                  onEntityConsumed={() => setSelectedCommunicationEntityId(null)}
                  onNavigateToTask={(taskId) => {
                    setSection("tasks");
                    setSelectedTaskId(taskId);
                  }}
                  onRefresh={refresh}
                />
              ) : null}

              {section === "documents" && currentCompany ? (
                <DocumentCenter
                  companyId={currentCompany.id}
                  documents={companyDocuments}
                  agents={companyAgents}
                  projects={companyProjects}
                  goals={companyGoals}
                  onRefresh={refresh}
                />
              ) : null}

              {section === "knowledge" && currentCompany ? (
                <KnowledgeBaseManager companyId={currentCompany.id} entries={companyKnowledge} onRefresh={refresh} />
              ) : null}

              {section === "meetings" && currentCompany ? (
                <MeetingsManager companyId={currentCompany.id} meetings={companyMeetings} agents={companyAgents} onRefresh={refresh} />
              ) : null}

              {section === "sprints" && currentCompany ? (
                <SprintManager companyId={currentCompany.id} sprints={companySprints} onRefresh={refresh} />
              ) : null}

              {section === "workspaces" && currentCompany ? (
                <EntityWorkspace
                  title="Workspaces"
                  eyebrow={undefined}
                  primary={
                    <Panel title="Workspace registry">
                      <WorkspaceList
                        workspaces={companyWorkspaces}
                        projects={companyProjects}
                        companyId={currentCompany!.id}
                        selectedWorkspaceId={selectedWorkspace?.id ?? null}
                        onSelect={setSelectedWorkspaceId}
                        onOpen={openPathWithFeedback}
                        onDeleted={refresh}
                      />
                    </Panel>
                  }
                  secondary={
                    <div className="space-y-6">
                      <Panel title="Workspace control center">
                        <WorkspaceInspector
                          workspace={selectedWorkspace}
                          agents={companyAgents}
                          tasks={tasks}
                          runs={runs}
                          documents={companyDocuments}
                          project={selectedWorkspace ? (companyProjects.find((project) => project.id === selectedWorkspace.projectId) ?? null) : null}
                          onOpen={openPathWithFeedback}
                        />
                      </Panel>
                      <Panel title="Add workspace">
                        <WorkspaceCreator companyId={currentCompany!.id} projects={companyProjects} onSaved={refresh} />
                      </Panel>
                    </div>
                  }
                />
              ) : null}

              {section === "settings" && currentCompany ? (
                <div className="space-y-10">
                  <Panel title="Profile and release">
                    <SettingsPane snapshot={snapshot} secrets={companySecrets} companyId={currentCompany!.id} onSaved={refresh} />
                  </Panel>
                  <Panel title="Secret bindings">
                    <SecretCreator companyId={currentCompany!.id} onSaved={refresh} />
                  </Panel>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
          </ErrorBoundary>
        </div>
        </div>
        </div>

        <AnimatePresence>
          {consoleOpen ? (
            <motion.section
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={panelTransition}
              className="shrink-0 overflow-hidden border-t border-[color:var(--line)] bg-[color:var(--panel)]"
            >
              <div className="flex items-center justify-between px-5 py-2.5">
                <div className="flex items-center gap-3">
                  <TerminalWindow size={15} className="text-[color:var(--muted)]" />
                  <span className="text-[13px] font-semibold text-[color:var(--text)]">{t("console.title")}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Select
                    compact
                    value={selectedRun?.id ?? ""}
                    onChange={setSelectedRunId}
                    options={runs.length > 0
                      ? runs.map((run) => ({ value: run.id, label: run.summary || `Run ${run.id.slice(0, 8)}` }))
                      : [{ value: "", label: t("console.noRuns") }]
                    }
                  />
                  <button
                    type="button"
                    className="focus-ring rounded-[6px] p-1 text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                    onClick={() => setConsoleOpen(false)}
                    aria-label="Close console"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div className="grid border-t border-[color:var(--line)] xl:grid-cols-[240px_minmax(0,1fr)]">
                <div className="border-b border-[color:var(--line)] px-5 py-3 xl:border-b-0 xl:border-r">
                  {selectedRun ? (
                    <div className="space-y-2.5 text-[12px] text-[color:var(--muted-strong)]">
                      <div className="flex items-center justify-between">
                        <span>{t("common.status")}</span>
                        <StatusPill status={selectedRun.status} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span>{t("common.started")}</span>
                        <span className="mono text-[11px]">{formatTime(selectedRun.startedAt)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>{t("common.finished")}</span>
                        <span className="mono text-[11px]">{formatTime(selectedRun.finishedAt)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>{t("common.cost")}</span>
                        <span className="mono text-[11px]">{formatMoney(selectedRun.costUsd)}</span>
                      </div>
                      {selectedRun.logPath ? (
                        <div className="pt-1">
                          <ActionButton label={t("common.openLog")} onClick={() => void openPathWithFeedback(selectedRun.logPath!)} icon={FolderOpen} />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="py-4 text-center text-[12px] text-[color:var(--muted)]">{t("common.noRunSelected")}</div>
                  )}
                </div>
                <div className="h-[200px] overflow-auto px-5 py-3">
                  <pre className="mono whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--muted-strong)]">
                    {selectedRun ? logBufferRef.current[selectedRun.id] ?? t("common.waitingForLog") : t("common.noRunSelected")}
                  </pre>
                </div>
              </div>
            </motion.section>
          ) : null}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {commandPaletteOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center bg-[color:var(--bg)]/72 px-4 pt-24 backdrop-blur-sm"
            onClick={() => { setCommandPaletteOpen(false); setCommandPaletteSearch(""); }}
          >
            <motion.div
              ref={paletteTrapRef}
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={panelTransition}
              className="w-full max-w-[560px] rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-5 py-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center gap-3">
                <MagnifyingGlass size={18} className="text-[color:var(--accent)]" />
                <input
                  type="text"
                  aria-label="Search"
                  className="flex-1 bg-transparent text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--muted)] outline-none"
                  placeholder={t("app.search")}
                  value={commandPaletteSearch}
                  onChange={(e) => setCommandPaletteSearch(e.target.value)}
                  autoFocus
                />
                {commandPaletteSearch && (
                  <button
                    className="text-[12px] text-[color:var(--muted)] hover:text-[color:var(--text)]"
                    onClick={() => setCommandPaletteSearch("")}
                  >
                    {t("app.clear")}
                  </button>
                )}
              </div>

              {filteredNavItems.length > 0 ? (
                <>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("entity.sections")}</div>
                  <ListFrame>
                    {filteredNavItems.map((item) => (
                      <ListRow
                        key={item.id}
                        className={`py-3 ${paletteActionIndex.get(`section:${item.id}`) === selectedPaletteIndex ? "bg-[color:var(--panel-soft)]" : ""}`}
                        onClick={() => {
                          navigateTo(item.id);
                          setCommandPaletteOpen(false);
                          setCommandPaletteSearch("");
                          setSelectedPaletteIndex(0);
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 text-[color:var(--text)]">
                            <item.icon size={16} />
                            <span className="text-[13px] tracking-[0.005em]">{item.label}</span>
                          </div>
                          <span className="mono text-[11px] text-[color:var(--muted)]">{item.id}</span>
                        </div>
                      </ListRow>
                    ))}
                  </ListFrame>
                </>
              ) : null}

              {hasEntityResults ? (
                <div className="mt-3 space-y-3">
                  {matchedAgents.length > 0 ? (
                    <>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("entity.agents")}</div>
                      <ListFrame>
                        {matchedAgents.map((agent) => (
                          <ListRow
                            key={agent.id}
                            className={`py-3 ${paletteActionIndex.get(`agent:${agent.id}`) === selectedPaletteIndex ? "bg-[color:var(--panel-soft)]" : ""}`}
                            onClick={() => {
                              navigateTo("agents", agent.id);
                              setCommandPaletteOpen(false);
                              setCommandPaletteSearch("");
                              setSelectedPaletteIndex(0);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 text-[color:var(--text)]">
                                <UsersThree size={16} />
                                <span className="text-[13px] tracking-[0.005em]">{agent.name}</span>
                                <span className="text-[11px] text-[color:var(--muted)]">{agent.role}</span>
                              </div>
                              <StatusPill status={agent.status} />
                            </div>
                          </ListRow>
                        ))}
                      </ListFrame>
                    </>
                  ) : null}

                  {matchedTasks.length > 0 ? (
                    <>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("entity.tasks")}</div>
                      <ListFrame>
                        {matchedTasks.map((task) => (
                          <ListRow
                            key={task.id}
                            className={`py-3 ${paletteActionIndex.get(`task:${task.id}`) === selectedPaletteIndex ? "bg-[color:var(--panel-soft)]" : ""}`}
                            onClick={() => {
                              navigateTo("tasks", task.id);
                              setCommandPaletteOpen(false);
                              setCommandPaletteSearch("");
                              setSelectedPaletteIndex(0);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 text-[color:var(--text)]">
                                <ListChecks size={16} />
                                <span className="text-[13px] tracking-[0.005em]">{task.title}</span>
                              </div>
                              <StatusPill status={task.status} />
                            </div>
                          </ListRow>
                        ))}
                      </ListFrame>
                    </>
                  ) : null}

                  {matchedRuns.length > 0 ? (
                    <>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("entity.runs")}</div>
                      <ListFrame>
                        {matchedRuns.map((run) => (
                          <ListRow
                            key={run.id}
                            className={`py-3 ${paletteActionIndex.get(`run:${run.id}`) === selectedPaletteIndex ? "bg-[color:var(--panel-soft)]" : ""}`}
                            onClick={() => {
                              navigateTo("runs", run.id);
                              setCommandPaletteOpen(false);
                              setCommandPaletteSearch("");
                              setSelectedPaletteIndex(0);
                            }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex items-center gap-3 text-[color:var(--text)]">
                                <TerminalWindow size={16} />
                                <span className="truncate text-[13px] tracking-[0.005em]">
                                  {run.summary || runs.find((entry) => entry.id === run.id)?.id.slice(0, 8) || run.id.slice(0, 8)}
                                </span>
                              </div>
                              <StatusPill status={run.status} />
                            </div>
                          </ListRow>
                        ))}
                      </ListFrame>
                    </>
                  ) : null}

                  {matchedGoals.length > 0 ? (
                    <>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("entity.goals")}</div>
                      <ListFrame>
                        {matchedGoals.map((goal) => (
                          <ListRow
                            key={goal.id}
                            className={`py-3 ${paletteActionIndex.get(`goal:${goal.id}`) === selectedPaletteIndex ? "bg-[color:var(--panel-soft)]" : ""}`}
                            onClick={() => {
                              navigateTo("goals", goal.id);
                              setCommandPaletteOpen(false);
                              setCommandPaletteSearch("");
                              setSelectedPaletteIndex(0);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 text-[color:var(--text)]">
                                <Target size={16} />
                                <span className="text-[13px] tracking-[0.005em]">{goal.title}</span>
                              </div>
                              <StatusPill status={goal.status} />
                            </div>
                          </ListRow>
                        ))}
                      </ListFrame>
                    </>
                  ) : null}

                  {matchedProjects.length > 0 ? (
                    <>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("entity.projects")}</div>
                      <ListFrame>
                        {matchedProjects.map((project) => (
                          <ListRow
                            key={project.id}
                            className={`py-3 ${paletteActionIndex.get(`project:${project.id}`) === selectedPaletteIndex ? "bg-[color:var(--panel-soft)]" : ""}`}
                            onClick={() => {
                              navigateTo("projects", project.id);
                              setCommandPaletteOpen(false);
                              setCommandPaletteSearch("");
                              setSelectedPaletteIndex(0);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 text-[color:var(--text)]">
                                <Kanban size={16} />
                                <span className="text-[13px] tracking-[0.005em]">{project.name}</span>
                              </div>
                              <StatusPill status={project.status} />
                            </div>
                          </ListRow>
                        ))}
                      </ListFrame>
                    </>
                  ) : null}
                </div>
              ) : null}

              {paletteQuery && filteredNavItems.length === 0 && !hasEntityResults ? (
                <div className="py-6 text-center text-[13px] text-[color:var(--muted)]">{t("app.noResults")} "{commandPaletteSearch}"</div>
              ) : null}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ToastContainer />
    </div>
    </TranslationContext.Provider>
    </LocaleContext.Provider>
  );
}
