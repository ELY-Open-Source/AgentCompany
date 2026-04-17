import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type { SectionId } from "@shared/types";

export interface NavigationSlice {
  section: SectionId;
  commandPaletteOpen: boolean;
  commandPaletteSearch: string;
  selectedPaletteIndex: number;
  consoleOpen: boolean;
  sidebarCollapsed: boolean;
  companySwitcherOpen: boolean;
  setSection: (section: SectionId) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteSearch: (search: string) => void;
  setSelectedPaletteIndex: (index: number) => void;
  setConsoleOpen: (open: boolean) => void;
  toggleConsole: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setCompanySwitcherOpen: (open: boolean) => void;
  toggleCompanySwitcher: () => void;
  navigateTo: (section: SectionId, entityId?: string) => void;
}

export const createNavigationSlice: StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  NavigationSlice
> = (set, get) => ({
  section: "overview",
  commandPaletteOpen: false,
  commandPaletteSearch: "",
  selectedPaletteIndex: 0,
  consoleOpen: false,
  sidebarCollapsed: false,
  companySwitcherOpen: false,
  setSection: (section) =>
    set((state) => {
      state.section = section;
    }),
  setCommandPaletteOpen: (open) =>
    set((state) => {
      state.commandPaletteOpen = open;
      if (!open) {
        state.commandPaletteSearch = "";
        state.selectedPaletteIndex = 0;
      }
    }),
  toggleCommandPalette: () =>
    set((state) => {
      state.commandPaletteOpen = !state.commandPaletteOpen;
      if (!state.commandPaletteOpen) {
        state.commandPaletteSearch = "";
        state.selectedPaletteIndex = 0;
      }
    }),
  setCommandPaletteSearch: (search) =>
    set((state) => {
      state.commandPaletteSearch = search;
      state.selectedPaletteIndex = 0;
    }),
  setSelectedPaletteIndex: (index) =>
    set((state) => {
      state.selectedPaletteIndex = index;
    }),
  setConsoleOpen: (open) =>
    set((state) => {
      state.consoleOpen = open;
    }),
  toggleConsole: () =>
    set((state) => {
      state.consoleOpen = !state.consoleOpen;
    }),
  setSidebarCollapsed: (collapsed) =>
    set((state) => {
      state.sidebarCollapsed = collapsed;
    }),
  toggleSidebar: () =>
    set((state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    }),
  setCompanySwitcherOpen: (open) =>
    set((state) => {
      state.companySwitcherOpen = open;
    }),
  toggleCompanySwitcher: () =>
    set((state) => {
      state.companySwitcherOpen = !state.companySwitcherOpen;
    }),
  navigateTo: (section, entityId) =>
    set((state) => {
      state.section = section;
      if (!entityId) return;
      if (section === "agents") state.selectedAgentId = entityId;
      else if (section === "approvals") state.selectedApprovalId = entityId;
      else if (section === "runs") {
        state.selectedRunId = entityId;
        state.consoleOpen = true;
      } else if (section === "goals") state.selectedGoalId = entityId;
      else if (section === "projects") state.selectedProjectId = entityId;
      else if (section === "connectors") state.selectedConnectorId = entityId;
      else if (section === "communication")
        state.selectedCommunicationEntityId = entityId;
      else if (section === "skills") state.selectedSkillId = entityId;
      else if (section === "tasks") {
        const snapshot = get().snapshot;
        const matchingTask = snapshot?.tasks.find((task) => task.id === entityId) ?? null;
        if (matchingTask) {
          state.selectedTaskId = matchingTask.id;
          return;
        }
        const matchingRun = snapshot?.runs.find((run) => run.id === entityId) ?? null;
        if (matchingRun) {
          state.selectedRunId = matchingRun.id;
          state.selectedTaskId = matchingRun.taskId;
          state.consoleOpen = true;
          return;
        }
        state.selectedTaskId = entityId;
      }
    }),
});
