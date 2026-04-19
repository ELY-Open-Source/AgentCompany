import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAppStore } from "@renderer/state/store";
import type { ProfileSnapshot, TaskRecord, RunRecord, AgentRecord, ApprovalRecord } from "@shared/types";

// Mock window.agentCompany for refreshSnapshot tests. Sidebar badges
// no longer traverse IPC — they are derived from the snapshot in
// `@shared/sidebar-badges`, so there is nothing store-level to mock
// for them.
const mockLoadSnapshot = vi.fn();
vi.stubGlobal("window", {
  agentCompany: {
    loadSnapshot: mockLoadSnapshot,
  },
});

describe("useAppStore", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAppStore.setState(useAppStore.getInitialState());
    vi.clearAllMocks();
  });

  it("is created without errors and has all 6 slice properties", () => {
    const state = useAppStore.getState();

    // NavigationSlice
    expect(state).toHaveProperty("section");
    expect(state).toHaveProperty("setSection");
    expect(state).toHaveProperty("commandPaletteOpen");
    expect(state).toHaveProperty("toggleCommandPalette");

    // CompanySlice
    expect(state).toHaveProperty("snapshot");
    expect(state).toHaveProperty("setSnapshot");
    expect(state).toHaveProperty("refreshSnapshot");

    // SelectionSlice
    expect(state).toHaveProperty("selectedTaskId");
    expect(state).toHaveProperty("clearCompanyScopedSelections");

    // UiSlice
    expect(state).toHaveProperty("locale");
    expect(state).toHaveProperty("setLocale");

    // CommunicationSlice - exists (even if minimal)
    expect(state).toBeDefined();

    // SocialSlice
    expect(state).toHaveProperty("socialAccounts");
    expect(state).toHaveProperty("setSocialAccounts");
  });

  it("NavigationSlice.setSection('tasks') updates section to 'tasks'", () => {
    expect(useAppStore.getState().section).toBe("overview");

    useAppStore.getState().setSection("tasks");

    expect(useAppStore.getState().section).toBe("tasks");
  });

  it("NavigationSlice.toggleCommandPalette() toggles commandPaletteOpen and clears search on close", () => {
    expect(useAppStore.getState().commandPaletteOpen).toBe(false);

    // Open
    useAppStore.getState().toggleCommandPalette();
    expect(useAppStore.getState().commandPaletteOpen).toBe(true);

    // Set some search state
    useAppStore.getState().setCommandPaletteSearch("test");
    useAppStore.getState().setSelectedPaletteIndex(3);
    expect(useAppStore.getState().commandPaletteSearch).toBe("test");
    expect(useAppStore.getState().selectedPaletteIndex).toBe(3);

    // Close -- should clear search and index
    useAppStore.getState().toggleCommandPalette();
    expect(useAppStore.getState().commandPaletteOpen).toBe(false);
    expect(useAppStore.getState().commandPaletteSearch).toBe("");
    expect(useAppStore.getState().selectedPaletteIndex).toBe(0);
  });

  it("NavigationSlice.navigateTo('agents', 'agent-123') sets section to 'agents' and selectedAgentId to 'agent-123'", () => {
    useAppStore.getState().navigateTo("agents", "agent-123");

    expect(useAppStore.getState().section).toBe("agents");
    expect(useAppStore.getState().selectedAgentId).toBe("agent-123");
  });

  it("SelectionSlice.clearCompanyScopedSelections() nulls all selection IDs", () => {
    // Set some selections
    useAppStore.getState().setSelectedTaskId("task-1");
    useAppStore.getState().setSelectedAgentId("agent-1");
    useAppStore.getState().setSelectedApprovalId("approval-1");
    useAppStore.getState().setSelectedRunId("run-1");
    useAppStore.getState().setSelectedGoalId("goal-1");
    useAppStore.getState().setSelectedProjectId("project-1");
    useAppStore.getState().setSelectedWorkspaceId("workspace-1");
    useAppStore.getState().setSelectedCommunicationEntityId("comm-1");
    useAppStore.getState().setSelectedConnectorId("conn-1");

    useAppStore.getState().clearCompanyScopedSelections();

    const state = useAppStore.getState();
    expect(state.selectedTaskId).toBeNull();
    expect(state.selectedAgentId).toBeNull();
    expect(state.selectedApprovalId).toBeNull();
    expect(state.selectedRunId).toBeNull();
    expect(state.selectedGoalId).toBeNull();
    expect(state.selectedProjectId).toBeNull();
    expect(state.selectedWorkspaceId).toBeNull();
    expect(state.selectedCommunicationEntityId).toBeNull();
    // Connector is NOT cleared per spec
    expect(state.selectedConnectorId).toBe("conn-1");
  });

  it("CompanySlice.setSnapshot(mockSnapshot) stores snapshot correctly", () => {
    const mockSnapshot: ProfileSnapshot = {
      currentCompanyId: "company-1",
      profilePath: "/test/path",
      updatesEnabled: true,
      theme: "system",
      locale: "en",
      backend: { secretBackend: "safe_storage" },
      companies: [],
      connectors: [],
      workspaces: [],
      agents: [],
      goals: [],
      projects: [],
      tasks: [],
      approvals: [],
      runs: [],
      costs: [],
      activity: [],
      secrets: [],
      comments: [],
      socialAccounts: [],
      meetings: [],
      documents: [],
      knowledgeBase: [],
      sprints: [],
      automationRules: [],
      agentMessages: [],
      workflows: [],
    };

    expect(useAppStore.getState().snapshot).toBeNull();

    useAppStore.getState().setSnapshot(mockSnapshot);

    expect(useAppStore.getState().snapshot).toEqual(mockSnapshot);
  });

  it("CompanySlice.refreshSnapshot() calls window.agentCompany.loadSnapshot()", async () => {
    const mockSnapshot: ProfileSnapshot = {
      currentCompanyId: "company-1",
      profilePath: "/test/path",
      updatesEnabled: true,
      theme: "system",
      locale: "en",
      backend: { secretBackend: "safe_storage" },
      companies: [],
      connectors: [],
      workspaces: [],
      agents: [],
      goals: [],
      projects: [],
      tasks: [],
      approvals: [],
      runs: [],
      costs: [],
      activity: [],
      secrets: [],
      comments: [],
      socialAccounts: [],
      meetings: [],
      documents: [],
      knowledgeBase: [],
      sprints: [],
      automationRules: [],
      agentMessages: [],
      workflows: [],
    };

    mockLoadSnapshot.mockResolvedValue({ ok: true, data: mockSnapshot });

    await useAppStore.getState().refreshSnapshot();

    expect(mockLoadSnapshot).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().snapshot).toEqual(mockSnapshot);
  });

  it("UiSlice.setLocale('zh') updates locale to 'zh'", () => {
    expect(useAppStore.getState().locale).toBe("en");

    useAppStore.getState().setLocale("zh");

    expect(useAppStore.getState().locale).toBe("zh");
  });

  it("SocialSlice.setSocialAccounts([account]) stores accounts", () => {
    const account = {
      id: "acc-1",
      companyId: "company-1",
      platform: "twitter" as const,
      accountName: "@test",
      displayName: "Test",
      profileUrl: "https://twitter.com/test",
      credentialSecretId: null,
      status: "active" as const,
      requireApproval: false,
      metadataJson: "{}",
      lastUsedAt: null,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };

    expect(useAppStore.getState().socialAccounts).toEqual([]);

    useAppStore.getState().setSocialAccounts([account]);

    expect(useAppStore.getState().socialAccounts).toEqual([account]);
  });
});

// -- Minimal snapshot fixture for patch tests --
function makeSnapshot(overrides: Partial<ProfileSnapshot> = {}): ProfileSnapshot {
  return {
    currentCompanyId: "company-1",
    profilePath: "/test/path",
    updatesEnabled: true,
    theme: "system",
    locale: "en",
    backend: { secretBackend: "safe_storage" },
    companies: [],
    connectors: [],
    workspaces: [],
    agents: [],
    goals: [],
    projects: [],
    tasks: [],
    approvals: [],
    runs: [],
    costs: [],
    activity: [],
    secrets: [],
    comments: [],
    socialAccounts: [],
    meetings: [],
    documents: [],
    knowledgeBase: [],
    sprints: [],
    automationRules: [],
    agentMessages: [],
    workflows: [],
    ...overrides,
  };
}

const fakeTask = (id: string, title = "Task"): TaskRecord => ({
  id,
  companyId: "company-1",
  projectId: null,
  goalId: null,
  parentId: null,
  title,
  description: "",
  assigneeAgentId: null,
  workspaceId: null,
  status: "open",
  priority: "medium",
  activeRunId: null,
  sessionJson: null,
  sessionDisplayId: null,
  requiresUserReview: false,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
} as unknown as TaskRecord);

const fakeRun = (id: string): RunRecord => ({
  id,
  companyId: "company-1",
  taskId: "t-1",
  agentId: "ag-1",
  workspaceId: null,
  connectorId: "claude-pro",
  status: "queued",
  summary: "",
  errorMessage: null,
  exitCode: null,
  signal: null,
  model: null,
  sessionDisplayId: null,
  unattributedCost: false,
  startedAt: null,
  finishedAt: null,
  logPath: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
} as RunRecord);

const fakeAgent = (id: string, name = "Agent"): AgentRecord => ({
  id,
  companyId: "company-1",
  name,
  role: "engineer",
  title: "",
  department: "engineering",
  status: "idle",
  reportsTo: null,
  connectorId: "claude-pro",
  workspaceId: null,
  model: null,
  capabilities: "",
  budgetMonthlyUsd: 100,
  spentMonthlyUsd: 0,
  metadataJson: "{}",
  heartbeatEnabled: false,
  heartbeatIntervalSec: 0,
  lastHeartbeatAt: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
} as AgentRecord);

const fakeApproval = (id: string): ApprovalRecord => ({
  id,
  companyId: "company-1",
  relatedTaskId: "t-1",
  relatedAgentId: null,
  requestedByAgentId: "ag-1",
  type: "task_completion",
  payloadSummary: "",
  impactSummary: "",
  payloadJson: null,
  decisionNote: null,
  state: "pending",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
} as unknown as ApprovalRecord);

describe("CompanySlice patch methods", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    vi.clearAllMocks();
  });

  // -- patchTask --
  it("patchTask inserts new task at beginning when task ID is not found", () => {
    const snapshot = makeSnapshot({ tasks: [fakeTask("t-existing")] });
    useAppStore.getState().setSnapshot(snapshot);

    const newTask = fakeTask("t-new", "New Task");
    useAppStore.getState().patchTask(newTask);

    const tasks = useAppStore.getState().snapshot!.tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.id).toBe("t-new");
    expect(tasks[1]!.id).toBe("t-existing");
  });

  it("patchTask updates existing task in-place when task ID matches", () => {
    const snapshot = makeSnapshot({ tasks: [fakeTask("t-1", "Original")] });
    useAppStore.getState().setSnapshot(snapshot);

    const updated = fakeTask("t-1", "Updated");
    useAppStore.getState().patchTask(updated);

    const tasks = useAppStore.getState().snapshot!.tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("Updated");
  });

  it("removeTask filters out task by ID", () => {
    const snapshot = makeSnapshot({ tasks: [fakeTask("t-1"), fakeTask("t-2")] });
    useAppStore.getState().setSnapshot(snapshot);

    useAppStore.getState().removeTask("t-1");

    const tasks = useAppStore.getState().snapshot!.tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe("t-2");
  });

  // -- patchRun --
  it("patchRun inserts new run when run ID is not found", () => {
    const snapshot = makeSnapshot({ runs: [fakeRun("r-existing")] });
    useAppStore.getState().setSnapshot(snapshot);

    useAppStore.getState().patchRun(fakeRun("r-new"));

    const runs = useAppStore.getState().snapshot!.runs;
    expect(runs).toHaveLength(2);
    expect(runs[0]!.id).toBe("r-new");
  });

  it("patchRun updates existing run in-place", () => {
    const run = fakeRun("r-1");
    const snapshot = makeSnapshot({ runs: [run] });
    useAppStore.getState().setSnapshot(snapshot);

    const updated = { ...fakeRun("r-1"), status: "running" as const };
    useAppStore.getState().patchRun(updated);

    const runs = useAppStore.getState().snapshot!.runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("running");
  });

  it("removeRun filters out run by ID", () => {
    const snapshot = makeSnapshot({ runs: [fakeRun("r-1"), fakeRun("r-2")] });
    useAppStore.getState().setSnapshot(snapshot);

    useAppStore.getState().removeRun("r-1");

    const runs = useAppStore.getState().snapshot!.runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).toBe("r-2");
  });

  // -- patchAgent --
  it("patchAgent inserts new agent when agent ID is not found", () => {
    const snapshot = makeSnapshot({ agents: [fakeAgent("ag-existing")] });
    useAppStore.getState().setSnapshot(snapshot);

    useAppStore.getState().patchAgent(fakeAgent("ag-new", "New Agent"));

    const agents = useAppStore.getState().snapshot!.agents;
    expect(agents).toHaveLength(2);
    expect(agents[0]!.id).toBe("ag-new");
  });

  it("patchAgent updates existing agent in-place", () => {
    const snapshot = makeSnapshot({ agents: [fakeAgent("ag-1", "Old")] });
    useAppStore.getState().setSnapshot(snapshot);

    useAppStore.getState().patchAgent(fakeAgent("ag-1", "New"));

    const agents = useAppStore.getState().snapshot!.agents;
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("New");
  });

  it("removeAgent filters out agent by ID", () => {
    const snapshot = makeSnapshot({ agents: [fakeAgent("ag-1"), fakeAgent("ag-2")] });
    useAppStore.getState().setSnapshot(snapshot);

    useAppStore.getState().removeAgent("ag-1");

    const agents = useAppStore.getState().snapshot!.agents;
    expect(agents).toHaveLength(1);
    expect(agents[0]!.id).toBe("ag-2");
  });

  // -- patchApproval --
  it("patchApproval inserts new approval when approval ID is not found", () => {
    const snapshot = makeSnapshot({ approvals: [fakeApproval("ap-existing")] });
    useAppStore.getState().setSnapshot(snapshot);

    useAppStore.getState().patchApproval(fakeApproval("ap-new"));

    const approvals = useAppStore.getState().snapshot!.approvals;
    expect(approvals).toHaveLength(2);
    expect(approvals[0]!.id).toBe("ap-new");
  });

  it("patchApproval updates existing approval in-place", () => {
    const approval = fakeApproval("ap-1");
    const snapshot = makeSnapshot({ approvals: [approval] });
    useAppStore.getState().setSnapshot(snapshot);

    const updated = { ...fakeApproval("ap-1"), state: "approved" as const };
    useAppStore.getState().patchApproval(updated);

    const approvals = useAppStore.getState().snapshot!.approvals;
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.state).toBe("approved");
  });

  it("removeApproval filters out approval by ID", () => {
    const snapshot = makeSnapshot({ approvals: [fakeApproval("ap-1"), fakeApproval("ap-2")] });
    useAppStore.getState().setSnapshot(snapshot);

    useAppStore.getState().removeApproval("ap-1");

    const approvals = useAppStore.getState().snapshot!.approvals;
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.id).toBe("ap-2");
  });

  // -- null-snapshot safety --
  it("patch methods are no-ops when snapshot is null", () => {
    expect(useAppStore.getState().snapshot).toBeNull();

    // These should not crash
    useAppStore.getState().patchTask(fakeTask("t-1"));
    useAppStore.getState().removeTask("t-1");
    useAppStore.getState().patchRun(fakeRun("r-1"));
    useAppStore.getState().removeRun("r-1");
    useAppStore.getState().patchAgent(fakeAgent("ag-1"));
    useAppStore.getState().removeAgent("ag-1");
    useAppStore.getState().patchApproval(fakeApproval("ap-1"));
    useAppStore.getState().removeApproval("ap-1");

    expect(useAppStore.getState().snapshot).toBeNull();
  });
});
