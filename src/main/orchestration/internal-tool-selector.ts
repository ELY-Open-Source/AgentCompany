/**
 * Decide which internal tools (`hire_agent`, `file_approval`) to attach
 * to a given run's agent (C4 part 3/5).
 *
 * The selector runs on main at dispatch time — the worker never
 * re-derives this. Rule set, in order:
 *
 *  - An agent that `canRequestHire` (CEO, HR, dept lead with reports,
 *    anyone with org-management authority) receives `hire_agent`.
 *  - A CEO (reportsTo null) additionally receives `file_approval` so
 *    the `approve_ceo_strategy` flow works without the HTTP shim. Peer
 *    agents use the HTTP path until the file_approval surface is
 *    generalised.
 *
 * No hedging, no sentinel values: if the DB lookup throws the caller
 * is already in a broken state and should not silently fall through
 * to an empty tool set.
 */

import type { AppDatabase } from "@main/database";
import type { AgentRecord } from "@shared/types";
import { canRequestHire } from "@main/agent-permissions";

export type InternalToolName = "hire_agent" | "file_approval";

export function resolveInternalToolsForAgent(
  db: AppDatabase,
  agent: AgentRecord,
): InternalToolName[] {
  const tools: InternalToolName[] = [];
  if (canRequestHire(db, agent.companyId, agent.id)) {
    tools.push("hire_agent");
  }
  // `file_approval` is currently scoped to the CEO (no manager) because
  // the canonical use case (`approve_ceo_strategy`) is CEO-only and
  // the broader approval surface ships via the HTTP route for now.
  // Widen the predicate when non-CEO agents need tool-call approvals.
  if (agent.reportsTo === null) {
    tools.push("file_approval");
  }
  return tools;
}
