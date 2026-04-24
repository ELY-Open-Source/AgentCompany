import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type {
  AgentRecord,
  ApprovalRecord,
  CompanyMetrics,
  ProfileSnapshot,
  RunRecord,
  StandupReport,
  TaskRecord,
} from "@shared/types";
import {
  describeDesktopError,
  formatDesktopResultError,
  normalizeAppErrorNotice,
  type AppErrorInput,
  type AppErrorNotice,
} from "../../lib/desktop";
import {
  assembleProfileSnapshot,
  splitProfileSnapshot,
  type ProfileSnapshotSections,
} from "../snapshot-sections";

// Sidebar badge counts and inbox items both live in the renderer —
// derived on every read from the snapshot (see `@shared/sidebar-badges`
// and `@shared/inbox-items`). The snapshot is the only source of
// truth; caching a separate `badges` or `inboxItems` field on this
// slice is what let the counters drift against the rendered content.
export interface CompanySlice {
  snapshot: ProfileSnapshot | null;
  snapshotSections: ProfileSnapshotSections | null;
  /**
   * Bumps only on full-snapshot replacements (setSnapshot / refreshSnapshot).
   * Granular patch/remove methods DO NOT bump this counter so that
   * section-IPC effects keyed on `snapshotRevision` fire only for genuine
   * re-fetches, not on every task/run/agent patch.
   */
  snapshotRevision: number;
  companyMetrics: CompanyMetrics | null;
  standupReport: StandupReport | null;
  error: AppErrorNotice | null;
  setSnapshot: (snapshot: ProfileSnapshot | null) => void;
  setCompanyMetrics: (metrics: CompanyMetrics | null) => void;
  setStandupReport: (report: StandupReport | null) => void;
  setError: (error: AppErrorInput) => void;
  refreshSnapshot: () => Promise<void>;
  patchTask: (task: TaskRecord) => void;
  removeTask: (taskId: string) => void;
  patchRun: (run: RunRecord) => void;
  removeRun: (runId: string) => void;
  patchAgent: (agent: AgentRecord) => void;
  removeAgent: (agentId: string) => void;
  patchApproval: (approval: ApprovalRecord) => void;
  removeApproval: (approvalId: string) => void;
}

function applySnapshotSections(
  state: CompanySlice,
  sections: ProfileSnapshotSections | null,
) {
  state.snapshotSections = sections;
  state.snapshot = sections ? assembleProfileSnapshot(sections) : null;
}

export const createCompanySlice: StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  CompanySlice
> = (set) => ({
  snapshot: null,
  snapshotSections: null,
  snapshotRevision: 0,
  companyMetrics: null,
  standupReport: null,
  error: null,
  setSnapshot: (snapshot) =>
    set((state) => {
      applySnapshotSections(state, snapshot ? splitProfileSnapshot(snapshot) : null);
      state.snapshotRevision += 1;
    }),
  setCompanyMetrics: (metrics) =>
    set((state) => {
      state.companyMetrics = metrics;
    }),
  setStandupReport: (report) =>
    set((state) => {
      state.standupReport = report;
    }),
  setError: (error) =>
    set((state) => {
      state.error = normalizeAppErrorNotice(error);
    }),
  refreshSnapshot: async () => {
    try {
      const result = await window.agentCompany.loadSnapshot();
      if (result.ok) {
        set((state) => {
          applySnapshotSections(state, splitProfileSnapshot(result.data));
          state.snapshotRevision += 1;
        });
      } else {
        set((state) => {
          state.error = formatDesktopResultError(result.error);
        });
      }
    } catch (err) {
      set((state) => {
        state.error = describeDesktopError(err);
      });
    }
  },

  // --- Granular patch methods for selective IPC updates ---

  patchTask: (task) =>
    set((state) => {
      if (!state.snapshotSections) return;
      const tasks = state.snapshotSections.company.tasks;
      const idx = tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        tasks[idx] = task;
      } else {
        tasks.unshift(task);
      }
      applySnapshotSections(state, state.snapshotSections);
    }),
  removeTask: (taskId) =>
    set((state) => {
      if (!state.snapshotSections) return;
      state.snapshotSections.company.tasks = state.snapshotSections.company.tasks.filter(
        (t) => t.id !== taskId,
      );
      applySnapshotSections(state, state.snapshotSections);
    }),

  patchRun: (run) =>
    set((state) => {
      if (!state.snapshotSections) return;
      const runs = state.snapshotSections.company.runs;
      const idx = runs.findIndex((r) => r.id === run.id);
      if (idx >= 0) {
        runs[idx] = run;
      } else {
        runs.unshift(run);
      }
      applySnapshotSections(state, state.snapshotSections);
    }),
  removeRun: (runId) =>
    set((state) => {
      if (!state.snapshotSections) return;
      state.snapshotSections.company.runs = state.snapshotSections.company.runs.filter(
        (r) => r.id !== runId,
      );
      applySnapshotSections(state, state.snapshotSections);
    }),

  patchAgent: (agent) =>
    set((state) => {
      if (!state.snapshotSections) return;
      const agents = state.snapshotSections.company.agents;
      const idx = agents.findIndex((a) => a.id === agent.id);
      if (idx >= 0) {
        agents[idx] = agent;
      } else {
        agents.unshift(agent);
      }
      applySnapshotSections(state, state.snapshotSections);
    }),
  removeAgent: (agentId) =>
    set((state) => {
      if (!state.snapshotSections) return;
      state.snapshotSections.company.agents = state.snapshotSections.company.agents.filter(
        (a) => a.id !== agentId,
      );
      applySnapshotSections(state, state.snapshotSections);
    }),

  patchApproval: (approval) =>
    set((state) => {
      if (!state.snapshotSections) return;
      const approvals = state.snapshotSections.company.approvals;
      const idx = approvals.findIndex((a) => a.id === approval.id);
      if (idx >= 0) {
        approvals[idx] = approval;
      } else {
        approvals.unshift(approval);
      }
      applySnapshotSections(state, state.snapshotSections);
    }),
  removeApproval: (approvalId) =>
    set((state) => {
      if (!state.snapshotSections) return;
      state.snapshotSections.company.approvals = state.snapshotSections.company.approvals.filter(
        (a) => a.id !== approvalId,
      );
      applySnapshotSections(state, state.snapshotSections);
    }),
});
