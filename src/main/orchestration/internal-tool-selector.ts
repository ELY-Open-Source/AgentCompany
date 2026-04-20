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
 *    role + `reportsTo === null`) receives `file_approval` so the
 *    `approve_ceo_strategy` flow works without the HTTP shim. Peer
 *    agents use the HTTP path until the file_approval surface is
 *    generalised.
 *
 * The two predicates are intentionally orthogonal — a VP with hiring
 * authority should not inherit CEO-strategy approval scope, and a CEO
 * with a virtual superior inserted above them should not silently
 * lose strategy scope either (guarded by `canFileCeoStrategy`'s role
 * check, not just `reportsTo`).
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
  if (canFileCeoStrategy(db, agent.companyId, agent.id)) {
    tools.push("file_approval");
  }
  return tools;
}
