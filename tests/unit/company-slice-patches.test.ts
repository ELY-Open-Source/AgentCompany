import { beforeEach, describe, expect, it, vi } from "vitest";
import { assembleProfileSnapshot } from "@renderer/state/snapshot-sections";
import { useAppStore } from "@renderer/state/store";
import type { AgentRecord, ApprovalRecord, ProfileSnapshot, RunRecord, TaskRecord } from "@shared/types";

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
    workProducts: [],
    knowledgeBase: [],
    sprints: [],
    automationRules: [],
    agentMessages: [],
    workflows: [],
    ...overrides,
  };
}

function expectSnapshotSectionsMatchSnapshot() {
  const { snapshot, snapshotSections } = useAppStore.getState();
  expect(snapshot).toEqual(snapshotSections ? assembleProfileSnapshot(snapshotSections) : null);
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

  it("patchTask inserts new task at beginning when task ID is missing", () => {
    useAppStore.getState().setSnapshot(makeSnapshot({ tasks: [fakeTask("t-existing")] }));

    useAppStore.getState().patchTask(fakeTask("t-new", "New Task"));

    const tasks = useAppStore.getState().snapshot!.tasks;
    expect(tasks.map((task) => task.id)).toEqual(["t-new", "t-existing"]);
    expect(useAppStore.getState().snapshotSections!.company.tasks.map((task) => task.id)).toEqual([
      "t-new",
      "t-existing",
    ]);
    expectSnapshotSectionsMatchSnapshot();
  });

  it("patchTask updates existing task in both section and compatibility snapshot", () => {
    useAppStore.getState().setSnapshot(makeSnapshot({ tasks: [fakeTask("t-1", "Original")] }));

    useAppStore.getState().patchTask(fakeTask("t-1", "Updated"));

    expect(useAppStore.getState().snapshot!.tasks[0]!.title).toBe("Updated");
    expect(useAppStore.getState().snapshotSections!.company.tasks[0]!.title).toBe("Updated");
    expectSnapshotSectionsMatchSnapshot();
  });

  it("removeTask filters task by ID in both section and compatibility snapshot", () => {
    useAppStore.getState().setSnapshot(makeSnapshot({ tasks: [fakeTask("t-1"), fakeTask("t-2")] }));

    useAppStore.getState().removeTask("t-1");

    expect(useAppStore.getState().snapshot!.tasks.map((task) => task.id)).toEqual(["t-2"]);
    expect(useAppStore.getState().snapshotSections!.company.tasks.map((task) => task.id)).toEqual(["t-2"]);
    expectSnapshotSectionsMatchSnapshot();
  });

  it("patchRun inserts and updates run records through snapshot sections", () => {
    useAppStore.getState().setSnapshot(makeSnapshot({ runs: [fakeRun("r-existing")] }));

    useAppStore.getState().patchRun(fakeRun("r-new"));
    useAppStore.getState().patchRun({ ...fakeRun("r-new"), status: "running" });

    expect(useAppStore.getState().snapshot!.runs.map((run) => `${run.id}:${run.status}`)).toEqual([
      "r-new:running",
      "r-existing:queued",
    ]);
    expect(useAppStore.getState().snapshotSections!.company.runs[0]!.status).toBe("running");
    expectSnapshotSectionsMatchSnapshot();
  });

  it("removeRun filters run by ID in both section and compatibility snapshot", () => {
    useAppStore.getState().setSnapshot(makeSnapshot({ runs: [fakeRun("r-1"), fakeRun("r-2")] }));

    useAppStore.getState().removeRun("r-1");

    expect(useAppStore.getState().snapshot!.runs.map((run) => run.id)).toEqual(["r-2"]);
    expect(useAppStore.getState().snapshotSections!.company.runs.map((run) => run.id)).toEqual(["r-2"]);
    expectSnapshotSectionsMatchSnapshot();
  });

  it("patchAgent inserts and updates agent records through snapshot sections", () => {
    useAppStore.getState().setSnapshot(makeSnapshot({ agents: [fakeAgent("ag-existing")] }));

    useAppStore.getState().patchAgent(fakeAgent("ag-new", "New Agent"));
    useAppStore.getState().patchAgent(fakeAgent("ag-new", "Renamed Agent"));

    expect(useAppStore.getState().snapshot!.agents.map((agent) => `${agent.id}:${agent.name}`)).toEqual([
      "ag-new:Renamed Agent",
      "ag-existing:Agent",
    ]);
    expect(useAppStore.getState().snapshotSections!.company.agents[0]!.name).toBe("Renamed Agent");
    expectSnapshotSectionsMatchSnapshot();
  });

  it("removeAgent filters agent by ID in both section and compatibility snapshot", () => {
    useAppStore.getState().setSnapshot(makeSnapshot({ agents: [fakeAgent("ag-1"), fakeAgent("ag-2")] }));

    useAppStore.getState().removeAgent("ag-1");

    expect(useAppStore.getState().snapshot!.agents.map((agent) => agent.id)).toEqual(["ag-2"]);
    expect(useAppStore.getState().snapshotSections!.company.agents.map((agent) => agent.id)).toEqual(["ag-2"]);
    expectSnapshotSectionsMatchSnapshot();
  });

  it("patchApproval inserts and updates approval records through snapshot sections", () => {
    useAppStore.getState().setSnapshot(makeSnapshot({ approvals: [fakeApproval("ap-existing")] }));

    useAppStore.getState().patchApproval(fakeApproval("ap-new"));
    useAppStore.getState().patchApproval({ ...fakeApproval("ap-new"), state: "approved" });

    expect(useAppStore.getState().snapshot!.approvals.map((approval) => `${approval.id}:${approval.state}`)).toEqual([
      "ap-new:approved",
      "ap-existing:pending",
    ]);
    expect(useAppStore.getState().snapshotSections!.company.approvals[0]!.state).toBe("approved");
    expectSnapshotSectionsMatchSnapshot();
  });

  it("removeApproval filters approval by ID in both section and compatibility snapshot", () => {
    useAppStore.getState().setSnapshot(makeSnapshot({ approvals: [fakeApproval("ap-1"), fakeApproval("ap-2")] }));

    useAppStore.getState().removeApproval("ap-1");

    expect(useAppStore.getState().snapshot!.approvals.map((approval) => approval.id)).toEqual(["ap-2"]);
    expect(useAppStore.getState().snapshotSections!.company.approvals.map((approval) => approval.id)).toEqual([
      "ap-2",
    ]);
    expectSnapshotSectionsMatchSnapshot();
  });

  it("patch methods leave null snapshot state unchanged", () => {
    expect(useAppStore.getState().snapshot).toBeNull();

    useAppStore.getState().patchTask(fakeTask("t-1"));
    useAppStore.getState().removeTask("t-1");
    useAppStore.getState().patchRun(fakeRun("r-1"));
    useAppStore.getState().removeRun("r-1");
    useAppStore.getState().patchAgent(fakeAgent("ag-1"));
    useAppStore.getState().removeAgent("ag-1");
    useAppStore.getState().patchApproval(fakeApproval("ap-1"));
    useAppStore.getState().removeApproval("ap-1");

    expect(useAppStore.getState().snapshot).toBeNull();
    expect(useAppStore.getState().snapshotSections).toBeNull();
  });
});
