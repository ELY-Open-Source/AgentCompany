import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type {
  AgentRecord,
  ApprovalRecord,
  CompanyMetrics,
  InboxItem,
  ProfileSnapshot,
  RunRecord,
  StandupReport,
  TaskRecord,
} from "@shared/types";
import type { SidebarBadges } from "@shared/contracts";

export interface CompanySlice {
  snapshot: ProfileSnapshot | null;
  currentCompanyId: string | null;
  companyMetrics: CompanyMetrics | null;
  standupReport: StandupReport | null;
  inboxItems: InboxItem[];
  badges: SidebarBadges | null;
  error: string | null;
  setSnapshot: (snapshot: ProfileSnapshot | null) => void;
  setCurrentCompanyId: (id: string | null) => void;
  setCompanyMetrics: (metrics: CompanyMetrics | null) => void;
  setStandupReport: (report: StandupReport | null) => void;
  setInboxItems: (items: InboxItem[]) => void;
  setBadges: (badges: SidebarBadges | null) => void;
  setError: (error: string | null) => void;
  refreshSnapshot: () => Promise<void>;
  patchTask: (task: TaskRecord) => void;
  removeTask: (taskId: string) => void;
  patchRun: (run: RunRecord) => void;
  removeRun: (runId: string) => void;
  patchAgent: (agent: AgentRecord) => void;
  removeAgent: (agentId: string) => void;
  patchApproval: (approval: ApprovalRecord) => void;
  removeApproval: (approvalId: string) => void;
  refreshBadges: () => Promise<void>;
}

export const createCompanySlice: StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  CompanySlice
> = (set, get) => ({
  snapshot: null,
  currentCompanyId: null,
  companyMetrics: null,
  standupReport: null,
  inboxItems: [],
  badges: null,
  error: null,
  setSnapshot: (snapshot) =>
    set((state) => {
      state.snapshot = snapshot;
    }),
  setCurrentCompanyId: (id) =>
    set((state) => {
      state.currentCompanyId = id;
    }),
  setCompanyMetrics: (metrics) =>
    set((state) => {
      state.companyMetrics = metrics;
    }),
  setStandupReport: (report) =>
    set((state) => {
      state.standupReport = report;
    }),
  setInboxItems: (items) =>
    set((state) => {
      state.inboxItems = items;
    }),
  setBadges: (badges) =>
    set((state) => {
      state.badges = badges;
    }),
  setError: (error) =>
    set((state) => {
      state.error = error;
    }),
  refreshSnapshot: async () => {
    try {
      const result = await window.agentCompany.loadSnapshot();
      if (result.ok) {
        set((state) => {
          state.snapshot = result.data;
        });
      } else {
        set((state) => {
          state.error = result.error.message;
        });
      }
    } catch (err) {
      set((state) => {
        state.error = err instanceof Error ? err.message : String(err);
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

  refreshBadges: async () => {
    const companyId = get().currentCompanyId;
    if (!companyId) return;
    try {
      const result = await window.agentCompany.getSidebarBadges(companyId);
      if (result.ok) {
        set((state) => {
          state.badges = result.data;
        });
      }
    } catch {
      /* ignore -- badges are non-critical */
    }
  },
});
