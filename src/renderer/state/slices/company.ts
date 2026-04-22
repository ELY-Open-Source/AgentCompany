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

// Sidebar badge counts and inbox items both live in the renderer —
// derived on every read from the snapshot (see `@shared/sidebar-badges`
// and `@shared/inbox-items`). The snapshot is the only source of
// truth; caching a separate `badges` or `inboxItems` field on this
// slice is what let the counters drift against the rendered content.
export interface CompanySlice {
  snapshot: ProfileSnapshot | null;
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

export const createCompanySlice: StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  CompanySlice
> = (set) => ({
  snapshot: null,
  snapshotRevision: 0,
  companyMetrics: null,
  standupReport: null,
  error: null,
  setSnapshot: (snapshot) =>
    set((state) => {
      state.snapshot = snapshot;
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
          state.snapshot = result.data;
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
      if (!state.snapshot) return;
      const idx = state.snapshot.tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        state.snapshot.tasks[idx] = task;
      } else {
        state.snapshot.tasks.unshift(task);
      }
    }),
  removeTask: (taskId) =>
    set((state) => {
      if (!state.snapshot) return;
      state.snapshot.tasks = state.snapshot.tasks.filter((t) => t.id !== taskId);
    }),

  patchRun: (run) =>
    set((state) => {
      if (!state.snapshot) return;
      const idx = state.snapshot.runs.findIndex((r) => r.id === run.id);
      if (idx >= 0) {
        state.snapshot.runs[idx] = run;
      } else {
        state.snapshot.runs.unshift(run);
      }
    }),
  removeRun: (runId) =>
    set((state) => {
      if (!state.snapshot) return;
      state.snapshot.runs = state.snapshot.runs.filter((r) => r.id !== runId);
    }),

  patchAgent: (agent) =>
    set((state) => {
      if (!state.snapshot) return;
      const idx = state.snapshot.agents.findIndex((a) => a.id === agent.id);
      if (idx >= 0) {
        state.snapshot.agents[idx] = agent;
      } else {
        state.snapshot.agents.unshift(agent);
      }
    }),
  removeAgent: (agentId) =>
    set((state) => {
      if (!state.snapshot) return;
      state.snapshot.agents = state.snapshot.agents.filter((a) => a.id !== agentId);
    }),

  patchApproval: (approval) =>
    set((state) => {
      if (!state.snapshot) return;
      const idx = state.snapshot.approvals.findIndex((a) => a.id === approval.id);
      if (idx >= 0) {
        state.snapshot.approvals[idx] = approval;
      } else {
        state.snapshot.approvals.unshift(approval);
      }
    }),
  removeApproval: (approvalId) =>
    set((state) => {
      if (!state.snapshot) return;
      state.snapshot.approvals = state.snapshot.approvals.filter((a) => a.id !== approvalId);
    }),
});
