import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type {
  CompanyMetrics,
  InboxItem,
  ProfileSnapshot,
  StandupReport,
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
}

export const createCompanySlice: StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  CompanySlice
> = (set) => ({
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
});
