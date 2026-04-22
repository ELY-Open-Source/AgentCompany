/**
 * Decide which internal tools (`hire_agent`, `file_approval`) to attach
 * to a given run's agent (C4 part 3/5).
 *
 * The selector runs on main at dispatch time — the worker never
 * re-derives this. Rule set, in order:
 *
 *  - An agent that `canRequestHire` (CEO, HR, dept lead with reports,
 *    anyone with org-management authority) receives `hire_agent`. A
 *    manager hiring an IC is a legitimate flow.
 *  - An agent that `canFileCeoStrategy` (genuine CEO: CEO-equivalent
 *    role + `reportsTo === null`) receives `file_approval` after the
 *    initial team-building phase has produced at least one hire.
 *
 * The two predicates are intentionally orthogonal: a VP with hiring
 * authority receives hiring scope, while CEO-strategy approval remains
 * pinned to the CEO role and the current org phase.
 *
 * No hedging, no sentinel values: if the DB lookup throws the caller
 * is already in a broken state and should not silently fall through
 * to an empty tool set.
 */

import type { AppDatabase } from "@main/database";
import type { AgentRecord } from "@shared/types";
import { canFileCeoStrategy, canRequestHire } from "@main/agent-permissions";

export type InternalToolName = "hire_agent" | "file_approval";

export function resolveInternalToolsForAgent(
  db: AppDatabase,
  agent: AgentRecord,
): InternalToolName[] {
  const tools: InternalToolName[] = [];
  if (canRequestHire(db, agent.companyId, agent.id)) {
    tools.push("hire_agent");
  }
  if (canFileCeoStrategy(db, agent.companyId, agent.id) && !isInitialTeamBuildingPhase(db, agent)) {
    tools.push("file_approval");
  }
  return tools;
}

function isInitialTeamBuildingPhase(db: AppDatabase, agent: AgentRecord): boolean {
  if (!canFileCeoStrategy(db, agent.companyId, agent.id)) return false;

  const directReports = db.core.agents.getDirectReports(agent.id, agent.companyId);
  const activeReports = directReports.filter(
    (report) => report.status !== "pending_approval" && report.status !== "terminated",
  );
  const pendingReportRows = directReports.filter((report) => report.status === "pending_approval");
  const pendingHireApprovals = db.core.approvals
    .listCompanyApprovalsByType(agent.companyId, "hire_agent")
    .filter((approval) => approval.state === "pending");
  const pendingStrategyApprovals = db.core.approvals
    .listCompanyApprovalsByType(agent.companyId, "approve_ceo_strategy")
    .filter((approval) => approval.state === "pending");

  return (
    activeReports.length === 0 &&
    pendingReportRows.length === 0 &&
    pendingHireApprovals.length === 0 &&
    pendingStrategyApprovals.length === 0
  );
}
