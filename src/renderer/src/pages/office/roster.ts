/** Agents who come to the office, in hire order: the office and the org chart read the same list. */
export function officeRoster<T extends { id: string; lifecycle: string; createdAt: string }>(agents: T[]): T[] {
  return agents
    .filter((agent) => agent.lifecycle === "active")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** The first c-suite agent on the roster holds the CEO office and wears the CEO's look. */
export function ceoIdOf(roster: Array<{ id: string; roleLevel: string }>): string | null {
  return roster.find((agent) => agent.roleLevel === "c_suite")?.id ?? null;
}
