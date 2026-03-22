import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAppStore } from "@renderer/state/store";
import type { ProfileSnapshot } from "@shared/types";

// Mock window.agentCompany for refreshSnapshot test
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
