/** How many decided approvals the page lists at first, and adds per "show more". */
export const DECIDED_PAGE = 24;

/** The newest `limit` decided approvals, plus the focused one when it is older, so a link to it always lands on it. */
export function decidedWindow<T extends { id: string }>(decided: T[], focusedId: string | null, limit: number): T[] {
  const shown = decided.slice(0, limit);
  const focused = focusedId === null ? undefined : decided.find((item) => item.id === focusedId);
  return focused && !shown.includes(focused) ? [...shown, focused] : shown;
}
