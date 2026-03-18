import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowClockwise,
  Bell,
  Brain,
  CalendarBlank,
  CaretUpDown,
  ChartBar,
  ChatCircle,
  Check,
  Command,
  Cpu,
  CurrencyCircleDollar,
  FileText,
  FolderOpen,
  Gear,
  Heartbeat,
  Kanban,
  Lightning,
  ListChecks,
  MagnifyingGlass,
  Megaphone,
  Plus,
  Pulse,
  Robot,
  Rows,
  ShieldCheck,
  Trash,
  UserPlus,
  SquaresFour,
  Target,
  TreeStructure,
  SidebarSimple,
  TerminalWindow,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type {
  CompanyRecord,
  CompanyMetrics,
  DesktopEvent,
  InboxItem,
  OnboardingBootstrapResult,
  ProfileSnapshot,
  RunRecord,
  SectionId,
  SocialAccountRecord,
  BrowserActionRecord,
  StandupReport,
} from "@shared/types";
import type { SidebarBadges } from "@shared/contracts";
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
import { unwrap } from "./lib/desktop";
import { formatMoney, formatTime } from "./lib/formatters";

type NavItem = { id: SectionId; label: string; icon: typeof SquaresFour };
type NavGroup = { label: string; items: NavItem[] };
type PaletteAction = {
  key: string;
  section: SectionId;
  entityId?: string;
};

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { id: "overview", label: "Dashboard", icon: SquaresFour },
      { id: "inbox", label: "Inbox", icon: Bell },
      { id: "standup", label: "Standup", icon: Heartbeat },
      { id: "performance", label: "Performance", icon: ChartBar },
      { id: "runs", label: "Runs", icon: TerminalWindow },
    ],
  },
  {
    label: "Organization",
    items: [
      { id: "agents", label: "Agents", icon: Robot },
      { id: "orgchart", label: "Org Chart", icon: TreeStructure },
      { id: "hiring", label: "Hiring", icon: UserPlus },
      { id: "communication", label: "Messages", icon: ChatCircle },
      { id: "goals", label: "Goals", icon: Target },
      { id: "projects", label: "Projects", icon: Kanban },
      { id: "tasks", label: "Tasks", icon: ListChecks },
      { id: "sprints", label: "Sprints", icon: Rows },
    ],
  },
  {
    label: "Automation",
    items: [
      { id: "automation", label: "Automation", icon: Lightning },
      { id: "approvals", label: "Approvals", icon: ShieldCheck },
    ],
  },
  {
    label: "Knowledge",
    items: [
      { id: "documents", label: "Documents", icon: FileText },
      { id: "knowledge", label: "Knowledge", icon: Brain },
      { id: "meetings", label: "Meetings", icon: CalendarBlank },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "costs", label: "Costs", icon: CurrencyCircleDollar },
      { id: "activity", label: "Activity", icon: Pulse },
      { id: "social", label: "Social Media", icon: Megaphone },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { id: "connectors", label: "Connectors", icon: Cpu },
      { id: "workspaces", label: "Workspaces", icon: FolderOpen },
    ],
  },
];

const navItems: NavItem[] = navGroups.flatMap((group) => group.items).concat({ id: "settings", label: "Settings", icon: Gear });

export function App() {
  const reducedMotion = useReducedMotion();
  const noMotion = { duration: 0 };
  const pageTransition = reducedMotion ? noMotion : { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const };
  const panelTransition = reducedMotion ? noMotion : { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const };

  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [section, setSection] = useState<SectionId>("overview");
  const [error, setError] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [companySwitcherOpen, setCompanySwitcherOpen] = useState(false);
  const [confirmDeleteCompanyId, setConfirmDeleteCompanyId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedCommunicationEntityId, setSelectedCommunicationEntityId] = useState<string | null>(null);
  const [taskViewMode, setTaskViewMode] = useState<"list" | "kanban">("list");
  const logBufferRef = useRef<Record<string, string>>({});
  const [, setLogRevision] = useState(0);
  const [badges, setBadges] = useState<SidebarBadges | null>(null);
  const [commandPaletteSearch, setCommandPaletteSearch] = useState("");
  const [selectedPaletteIndex, setSelectedPaletteIndex] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [initialOnboardingLocked, setInitialOnboardingLocked] = useState(false);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [companyMetrics, setCompanyMetrics] = useState<CompanyMetrics | null>(null);
  const [standupReport, setStandupReport] = useState<StandupReport | null>(null);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccountRecord[]>([]);
  const [browserActions, setBrowserActions] = useState<BrowserActionRecord[]>([]);

  const clearCompanyScopedUiState = useCallback(() => {
    setSelectedTaskId(null);
    setSelectedApprovalId(null);
    setSelectedRunId(null);
    setSelectedAgentId(null);
    setSelectedGoalId(null);
    setSelectedProjectId(null);
    setSelectedWorkspaceId(null);
    setSelectedCommunicationEntityId(null);
    setInboxItems([]);
    setCompanyMetrics(null);
    setStandupReport(null);
    setSocialAccounts([]);
    setBrowserActions([]);
    setBadges(null);
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

  // Stable ref so the subscribe callback always calls the latest refresh
  // without tearing down the subscription when refresh identity changes.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Debounce timer ref for coalescing rapid real-time events
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedRefresh = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void refreshRef.current();
    }, 500);
  }, []);

  useEffect(() => {
    void refreshRef.current();
    const unsubscribe = window.agentCompany.subscribe((event: DesktopEvent) => {
      if (event.type === "run-log") {
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
        setLogRevision((r) => r + 1);
        return;
      }
      if (event.type === "shortcut") {
        if (event.action === "toggle-command-palette") setCommandPaletteOpen((current) => !current);
        if (event.action === "toggle-console") setConsoleOpen((current) => !current);
        if (event.action === "refresh") void refreshRef.current();
        return;
      }
      // All data-mutating events trigger a debounced snapshot reload:
      // domain-changed, run-status, new-message, automation-fired, heartbeat-status
      debouncedRefresh();
    });
    return () => {
      unsubscribe();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [debouncedRefresh]);

  useEffect(() => {
    if (!snapshot) return;
    const root = document.documentElement;
    root.dataset.theme = snapshot.theme;
    root.style.colorScheme = snapshot.theme === "system" ? "light dark" : snapshot.theme;
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot?.currentCompanyId) return;
    const companyId = snapshot.currentCompanyId;
    let cancelled = false;

    if (section === "inbox") {
      setInboxItems([]);
    }

    if (section === "performance") {
      setCompanyMetrics(null);
    }

    if (section === "standup") {
      setStandupReport(null);
    }

    if (section === "social") {
      setSocialAccounts([]);
    }

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
        setLogRevision((r) => r + 1);
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
    inbox: activeInboxCount > 0 ? { count: activeInboxCount, tone: "warn" } : undefined,
    runs:
      badges.failedRuns > 0
        ? { count: badges.failedRuns, tone: "danger" }
        : badges.activeRuns > 0
          ? { count: badges.activeRuns, tone: "default" }
          : undefined,
    tasks: badges.todoTasks > 0 ? { count: badges.todoTasks, tone: "default" } : undefined,
    approvals: badges.pendingApprovals > 0 ? { count: badges.pendingApprovals, tone: "warn" } : undefined,
    costs: badges.budgetWarnings > 0 ? { count: badges.budgetWarnings, tone: "danger" } : undefined,
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
        setSelectedPaletteIndex((current) => (current + 1) % paletteActions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedPaletteIndex((current) => (current - 1 + paletteActions.length) % paletteActions.length);
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
    if (summary.runId) {
      setSection("runs");
      setSelectedRunId(summary.runId);
      setConsoleOpen(true);
      return;
    }
    if (summary.taskId) {
      setSection("tasks");
      setSelectedTaskId(summary.taskId);
      return;
    }
    if (summary.projectId) {
      setSection("projects");
      setSelectedProjectId(summary.projectId);
      return;
    }
    if (summary.leadAgentId) {
      setSection("agents");
      setSelectedAgentId(summary.leadAgentId);
    }
  }, [refresh]);

  if (!snapshot) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center text-[13px] text-[color:var(--muted)]">
        Loading local profile...
      </div>
    );
  }

  if (snapshot.companies.length === 0 || showOnboarding || initialOnboardingLocked) {
    return <CompanyOnboarding connectors={snapshot.connectors} onDone={handleOnboardingDone} canCancel={snapshot.companies.length > 0 && !initialOnboardingLocked} onCancel={() => {
      setShowOnboarding(false);
      setInitialOnboardingLocked(false);
      setError(null);
    }} />;
  }

  return (
    <div className={`grid h-[100dvh] overflow-hidden bg-[color:var(--bg)] ${sidebarCollapsed ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[220px_minmax(0,1fr)]"}`}>
      <aside className="flex h-[100dvh] flex-col overflow-hidden border-r border-[color:var(--line)] bg-[color:var(--panel)]">
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
                onClick={() => setCompanySwitcherOpen((v) => !v)}
              >
                <span className="min-w-0 flex-1 truncate">{currentCompany?.name ?? "Select company"}</span>
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
                                className="rounded px-2 py-0.5 text-[11px] font-semibold text-[color:var(--danger)] transition hover:bg-[color:var(--danger)] hover:text-white"
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
                                className="mr-2 rounded p-1 text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--danger)] hover:text-white group-hover:opacity-100"
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
                        <span>New company</span>
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
        <nav aria-label="Main navigation" className={`flex-1 overflow-y-auto pb-3 ${sidebarCollapsed ? "px-1.5" : "px-3"}`}>
          {navGroups.map((group) => (
            <div key={group.label} className="mb-1">
              {!sidebarCollapsed ? (
                <div className="px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{group.label}</div>
              ) : (
                <div className="pb-1 pt-3" />
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
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
            </div>
          ))}
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
            onClick={() => setSidebarCollapsed((c) => !c)}
          >
            <SidebarSimple size={sidebarCollapsed ? 18 : 17} />
            {!sidebarCollapsed ? <span className="text-[13px] font-medium tracking-[0.005em]">Collapse</span> : null}
          </button>
        </div>
      </aside>

      <main aria-label="Content" className="flex min-w-0 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[1040px] flex-col px-6 py-6 lg:px-10 lg:py-8">
        <header className="mb-8 flex items-start justify-between gap-4 border-b border-[color:var(--line)] pb-5 lg:mb-10 lg:gap-6">
          <h1 className="text-[24px] tracking-[-0.03em] text-[color:var(--text)] lg:text-[31px]">
            {navItems.find((item) => item.id === section)?.label}
          </h1>
          <div className="flex shrink-0 items-center gap-3 lg:gap-5">
            <button
              type="button"
              aria-label="Refresh"
              title="Refresh"
              className="focus-ring inline-flex items-center gap-2 py-1 text-[12px] font-semibold text-[color:var(--muted-strong)] transition hover:text-[color:var(--text)]"
              onClick={() => void refresh()}
            >
              <ArrowClockwise size={16} />
              <span className="hidden lg:inline">Refresh</span>
            </button>
            <button
              type="button"
              aria-label={consoleOpen ? "Hide console" : "Show console"}
              title={consoleOpen ? "Hide console" : "Show console"}
              className="focus-ring inline-flex items-center gap-2 py-1 text-[12px] font-semibold text-[color:var(--muted-strong)] transition hover:text-[color:var(--text)]"
              onClick={() => setConsoleOpen((current) => !current)}
            >
              <TerminalWindow size={16} />
              <span className="hidden lg:inline">{consoleOpen ? "Hide console" : "Show console"}</span>
            </button>
          </div>
        </header>

        {error ? (
          <div className="mb-6 flex items-center gap-3 rounded-[10px] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
            <WarningCircle size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          <ErrorBoundary>
            <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={pageTransition}
              className="space-y-14"
            >
              {section === "overview" ? (
                <Dashboard
                  agents={companyAgents}
                  tasks={tasks}
                  runs={runs}
                  approvals={approvals}
                  goals={companyGoals}
                  projects={companyProjects}
                  activity={filteredActivity}
                  costs={companyCosts}
                  connectors={snapshot.connectors}
                  meetings={companyMeetings}
                  sprints={companySprints}
                  messages={snapshot.agentMessages?.filter((message) => !currentCompany || message.companyId === currentCompany.id) ?? []}
                  browserActions={browserActions}
                  workflows={snapshot.workflows?.filter((workflow) => !currentCompany || workflow.companyId === currentCompany.id) ?? []}
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
                    unwrap(await window.agentCompany.openPath(path));
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
                  <Panel title="Agent roster" action={<ActionButton label="New agent" icon={Robot} tone="accent" onClick={() => setSelectedAgentId("__new__")} />}>
                    <AgentRoster
                      agents={companyAgents}
                      connectors={snapshot.connectors}
                      workspaces={companyWorkspaces}
                      selectedAgentId={selectedAgentId}
                      onSelect={setSelectedAgentId}
                    />
                  </Panel>
                  <Modal open={selectedAgentId === "__new__"} title="New agent" onClose={() => setSelectedAgentId(null)}>
                    <AgentCreator companyId={currentCompany!.id} connectors={snapshot.connectors} workspaces={companyWorkspaces} agents={companyAgents} onSaved={async () => { setSelectedAgentId(null); await refresh(); }} />
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

              {section === "workspaces" ? (
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
                        onOpen={(path) => window.agentCompany.openPath(path).then(() => undefined)}
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
                          onOpen={(path) => window.agentCompany.openPath(path).then(() => undefined)}
                        />
                      </Panel>
                      <Panel title="Add workspace">
                        <WorkspaceCreator companyId={currentCompany!.id} projects={companyProjects} onSaved={refresh} />
                      </Panel>
                    </div>
                  }
                />
              ) : null}

              {section === "settings" ? (
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
                  <span className="text-[13px] font-semibold text-[color:var(--text)]">Console</span>
                </div>
                <div className="flex items-center gap-3">
                  <Select
                    compact
                    value={selectedRun?.id ?? ""}
                    onChange={setSelectedRunId}
                    options={(runs.length > 0 ? runs : [{ id: "", summary: "No runs" } as RunRecord]).map((run) => ({
                      value: run.id,
                      label: run.summary || `Run ${run.id.slice(0, 8)}`,
                    }))}
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
                        <span>Status</span>
                        <StatusPill status={selectedRun.status} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Started</span>
                        <span className="mono text-[11px]">{formatTime(selectedRun.startedAt)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Finished</span>
                        <span className="mono text-[11px]">{formatTime(selectedRun.finishedAt)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Cost</span>
                        <span className="mono text-[11px]">{formatMoney(selectedRun.costUsd)}</span>
                      </div>
                      {selectedRun.logPath ? (
                        <div className="pt-1">
                          <ActionButton label="Open log" onClick={() => void window.agentCompany.openPath(selectedRun.logPath!)} icon={FolderOpen} />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="py-4 text-center text-[12px] text-[color:var(--muted)]">No run selected</div>
                  )}
                </div>
                <div className="h-[200px] overflow-auto px-5 py-3">
                  <pre className="mono whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--muted-strong)]">
                    {selectedRun ? logBufferRef.current[selectedRun.id] ?? "Waiting for log output..." : "No run selected."}
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
              className="w-full max-w-[560px] rounded-[12px] border border-[color:var(--line)] bg-[color:var(--panel)] px-5 py-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center gap-3">
                <MagnifyingGlass size={18} className="text-[color:var(--accent)]" />
                <input
                  type="text"
                  aria-label="Search"
                  className="flex-1 bg-transparent text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--muted)] outline-none"
                  placeholder="Search sections, agents, tasks, goals, projects..."
                  value={commandPaletteSearch}
                  onChange={(e) => setCommandPaletteSearch(e.target.value)}
                  autoFocus
                />
                {commandPaletteSearch && (
                  <button
                    className="text-[12px] text-[color:var(--muted)] hover:text-[color:var(--text)]"
                    onClick={() => setCommandPaletteSearch("")}
                  >
                    Clear
                  </button>
                )}
              </div>

              {filteredNavItems.length > 0 ? (
                <>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Sections</div>
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
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Agents</div>
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
                                <Robot size={16} />
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
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Tasks</div>
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
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Runs</div>
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
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Goals</div>
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
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Projects</div>
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
                <div className="py-6 text-center text-[13px] text-[color:var(--muted)]">No results for "{commandPaletteSearch}"</div>
              ) : null}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

    </div>
  );
}
