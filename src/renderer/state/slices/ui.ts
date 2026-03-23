import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type { AppLocale } from "@shared/locale";
import { DEFAULT_LOCALE } from "@shared/locale";

export interface Toast {
  id: string;
  message: string;
  tone: "success" | "danger" | "warn";
}

function nextToastId() { return `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

export interface UiSlice {
  locale: AppLocale;
  showOnboarding: boolean;
  initialOnboardingLocked: boolean;
  confirmDeleteCompanyId: string | null;
  taskViewMode: "list" | "kanban";
  logRevision: number;
  toasts: Toast[];
  setLocale: (locale: AppLocale) => void;
  setShowOnboarding: (show: boolean) => void;
  setInitialOnboardingLocked: (locked: boolean) => void;
  setConfirmDeleteCompanyId: (id: string | null) => void;
  setTaskViewMode: (mode: "list" | "kanban") => void;
  incrementLogRevision: () => void;
  addToast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: string) => void;
}

export const createUiSlice: StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  UiSlice
> = (set) => ({
  locale: DEFAULT_LOCALE,
  showOnboarding: false,
  initialOnboardingLocked: false,
  confirmDeleteCompanyId: null,
  taskViewMode: "list",
  logRevision: 0,
  toasts: [],
  setLocale: (locale) =>
    set((state) => {
      state.locale = locale;
    }),
  setShowOnboarding: (show) =>
    set((state) => {
      state.showOnboarding = show;
    }),
  setInitialOnboardingLocked: (locked) =>
    set((state) => {
      state.initialOnboardingLocked = locked;
    }),
  setConfirmDeleteCompanyId: (id) =>
    set((state) => {
      state.confirmDeleteCompanyId = id;
    }),
  setTaskViewMode: (mode) =>
    set((state) => {
      state.taskViewMode = mode;
    }),
  incrementLogRevision: () =>
    set((state) => {
      state.logRevision += 1;
    }),
  addToast: (message, tone = "success") => {
    const id = nextToastId();
    set((state) => { state.toasts.push({ id, message, tone }); });
    setTimeout(() => {
      set((state) => { state.toasts = state.toasts.filter((t) => t.id !== id); });
    }, 4000);
  },
  dismissToast: (id) =>
    set((state) => { state.toasts = state.toasts.filter((t) => t.id !== id); }),
});
