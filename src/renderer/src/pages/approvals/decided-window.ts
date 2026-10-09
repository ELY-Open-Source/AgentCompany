/** How many decided approvals the page lists. */
export const DECIDED_SHOWN = 24;

/** The newest decided approvals, plus the focused one when it is older, so a link to it always lands on it. */
export function decidedWindow<T extends { id: string }>(decided: T[], focusedId: string | null): T[] {
  const shown = decided.slice(0, DECIDED_SHOWN);
  const focused = focusedId === null ? undefined : decided.find((item) => item.id === focusedId);
  return focused && !shown.includes(focused) ? [...shown, focused] : shown;
}
