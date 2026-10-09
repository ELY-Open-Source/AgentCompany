import { createContext, useContext } from "react";

/** Runs `proceed` now, or after the user confirms leaving input that would be lost (any page-scoped unsaved input). */
export const LeaveGuardContext = createContext<(proceed: () => void) => void>((proceed) => proceed());

export function useLeaveGuard(): (proceed: () => void) => void {
  return useContext(LeaveGuardContext);
}
