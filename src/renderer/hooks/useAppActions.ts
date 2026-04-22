import { createContext, useContext } from "react";
import type { AppErrorInput } from "../lib/desktop";

export interface AppActions {
  refresh: () => Promise<void>;
  setError: (error: AppErrorInput) => void;
  openPathWithFeedback: (path: string) => Promise<void>;
  startRun: (taskId: string) => Promise<void>;
  cancelRun: (runId: string) => Promise<void>;
}

export const AppActionsContext = createContext<AppActions | null>(null);

export function useAppActions(): AppActions {
  const value = useContext(AppActionsContext);
  if (!value) throw new Error("useAppActions must be used inside <AppActionsContext.Provider>");
  return value;
}
