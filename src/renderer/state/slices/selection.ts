import type { StateCreator } from "zustand";
import type { AppState } from "../store";

export interface SelectionSlice {
  selectedTaskId: string | null;
  selectedConnectorId: string | null;
  selectedApprovalId: string | null;
  selectedRunId: string | null;
  /** Highlighted agent (roster row / orgchart card). Navigation target.
   *  Does NOT control the Edit modal — see editingAgentId. */
  selectedAgentId: string | null;
  /** Agent whose Edit modal is currently open, or NEW_ENTITY_ID for the
   *  new-hire request modal. Only set by explicit user action (row click,
   *  card click, "Request new hire" button); never by navigation or
   *  onboarding defaults. Cleared on modal close. */
  editingAgentId: string | null;
  selectedGoalId: string | null;
  selectedProjectId: string | null;
  selectedWorkspaceId: string | null;
  selectedCommunicationEntityId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  setSelectedConnectorId: (id: string | null) => void;
  setSelectedApprovalId: (id: string | null) => void;
  setSelectedRunId: (id: string | null) => void;
  setSelectedAgentId: (id: string | null) => void;
  setEditingAgentId: (id: string | null) => void;
  setSelectedGoalId: (id: string | null) => void;
  setSelectedProjectId: (id: string | null) => void;
  setSelectedWorkspaceId: (id: string | null) => void;
  setSelectedCommunicationEntityId: (id: string | null) => void;
  clearCompanyScopedSelections: () => void;
}

export const createSelectionSlice: StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  SelectionSlice
> = (set) => ({
  selectedTaskId: null,
  selectedConnectorId: null,
  selectedApprovalId: null,
  selectedRunId: null,
  selectedAgentId: null,
  editingAgentId: null,
  selectedGoalId: null,
  selectedProjectId: null,
  selectedWorkspaceId: null,
  selectedCommunicationEntityId: null,
  setSelectedTaskId: (id) =>
    set((state) => {
      state.selectedTaskId = id;
    }),
  setSelectedConnectorId: (id) =>
    set((state) => {
      state.selectedConnectorId = id;
    }),
  setSelectedApprovalId: (id) =>
    set((state) => {
      state.selectedApprovalId = id;
    }),
  setSelectedRunId: (id) =>
    set((state) => {
      state.selectedRunId = id;
    }),
  setSelectedAgentId: (id) =>
    set((state) => {
      state.selectedAgentId = id;
    }),
  setEditingAgentId: (id) =>
    set((state) => {
      state.editingAgentId = id;
    }),
  setSelectedGoalId: (id) =>
    set((state) => {
      state.selectedGoalId = id;
    }),
  setSelectedProjectId: (id) =>
    set((state) => {
      state.selectedProjectId = id;
    }),
  setSelectedWorkspaceId: (id) =>
    set((state) => {
      state.selectedWorkspaceId = id;
    }),
  setSelectedCommunicationEntityId: (id) =>
    set((state) => {
      state.selectedCommunicationEntityId = id;
    }),
  clearCompanyScopedSelections: () =>
    set((state) => {
      state.selectedTaskId = null;
      state.selectedApprovalId = null;
      state.selectedRunId = null;
      state.selectedAgentId = null;
      state.editingAgentId = null;
      state.selectedGoalId = null;
      state.selectedProjectId = null;
      state.selectedWorkspaceId = null;
      state.selectedCommunicationEntityId = null;
      // selectedConnectorId is NOT cleared -- connectors are global
    }),
});
