/** The CEO's first-hire rule, shared by its instructions, the goal kickoff and the hire_agent tool. */
export const CEO_FIRST_HIRES = "hire 2-4 chief officers (hire_agent, seniority \"director\", titles like CTO, CFO, CMO, COO) for the functions the goal needs, not a flat pool of individual contributors";

/** Who a leader at this rank hires first. */
export function firstHiresFor(roleLevel: string): string {
  if (roleLevel === "c_suite") return CEO_FIRST_HIRES;
  if (roleLevel === "director") return "hire the managers (hire_agent, seniority \"lead\") and staff your department needs";
  return "hire the staff your team needs (hire_agent)";
}

/** Directors and leads lead even before their first hire; anyone with reports leads too. */
export function leadsPeople(roleLevel: string, hasReports: boolean): boolean {
  return hasReports || roleLevel === "c_suite" || roleLevel === "director" || roleLevel === "lead";
}
