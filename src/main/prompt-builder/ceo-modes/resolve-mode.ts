/**
 * Pure resolver for the four CEO operating modes.
 *
 * The runtime decision "what phase is this CEO in" used to live in two
 * parallel code paths that each derived a mode from the agent+company
 * state independently — `operating-instructions-ceo.resolveMode` chose
 * the markdown template, while `orchestration/initial-user-turn`
 * separately decided the first user turn. Inconsistent outputs between
 * the two produced the failure mode where the system prompt announced
 * "your team is empty" while the turn cue read "continue on your most
 * actionable task", or vice versa.
 *
 * This module introduces the single deterministic function
 * `resolveCeoMode(input)` that M7 picks up for both call sites in a
 * later phase. Phase 1 (this change) only ships the function and its
 * unit tests — neither `operating-instructions-ceo.ts` nor
 * `initial-user-turn.ts` is rewired yet. That keeps the behavioral
 * change surface exactly zero while giving M7 Phase 2 a shared
 * implementation to converge onto.
 *
 * The function is pure: no DB, no IO, no side effects. Every input is
 * a projection the caller already has in hand (the CEO agent row, the
 * company row, the filtered list of direct reports, the pending
 * approvals list). That makes it trivial to exercise via table-driven
 * unit tests without standing up a runtime.
 */

import type { AgentRecord, ApprovalRecord, CompanyRecord } from "@shared/types";

/**
 * Operating mode for a CEO agent.
 *
 *  - `team_building`: no active team yet and nothing in flight — the
 *    CEO's only legitimate action is filing hires.
 *  - `awaiting_hire`: hire approvals are pending but no active team
 *    exists yet. Check approval status, resubmit on revision, stop.
 *  - `awaiting_org`: an `approve_ceo_strategy` approval is pending.
 *    The board owes a decision before tasks can begin.
 *  - `operating`: team exists, strategy is approved, the CEO runs the
 *    business.
 */
export type CeoMode = "team_building" | "awaiting_hire" | "awaiting_org" | "operating";

export interface ResolveCeoModeInput {
  /** The CEO agent. Function asserts `role === "ceo"` to catch mis-calls. */
  agent: AgentRecord;
  /** The company the CEO owns. Only used to scope the assertion. */
  company: CompanyRecord;
  /**
   * Direct reports of the CEO. Callers pass the full set — the resolver
   * filters out `pending_approval` (a report still blocked in a hire
   * approval doesn't count as "active") and `terminated` here, so every
   * call site uses the same predicate.
   */
  reports: AgentRecord[];
  /**
   * Pending approvals owned by this company. The resolver scans for
   * `approve_ceo_strategy` to detect the awaiting_org gate.
   */
  pendingApprovals: ApprovalRecord[];
}

/**
 * Classify the CEO's current operating mode from its immediate state.
 *
 * Priority ordering (first match wins):
 *
 *  1. `awaiting_org` — if an `approve_ceo_strategy` approval is
 *     pending, the org shape itself is in board review. Do not advance
 *     to operating regardless of team size.
 *  2. `team_building` — no active reports AND no pending hires. The
 *     CEO has nothing to manage and nothing in flight.
 *  3. `awaiting_hire` — no active reports but hires are pending board
 *     approval. Same "can't manage anyone yet" constraint, different
 *     action (check status, don't file duplicates).
 *  4. `operating` — default. At least one active report and no
 *     org-strategy approval outstanding.
 *
 * The order matches the "external dependency first" rule: org strategy
 * review gates everything downstream, so it outranks team composition
 * signals. Between `team_building` and `awaiting_hire` the distinction
 * is whether hires exist to wait on; both share the "no team yet"
 * constraint but lead to different CEO actions.
 */
export function resolveCeoMode(input: ResolveCeoModeInput): CeoMode {
  if (input.agent.role !== "ceo") {
    throw new Error(
      `resolveCeoMode called with non-CEO agent (id=${input.agent.id}, role=${input.agent.role})`,
    );
  }
  if (input.agent.companyId !== input.company.id) {
    throw new Error(
      `resolveCeoMode called with mismatched company: agent.companyId=${input.agent.companyId}, company.id=${input.company.id}`,
    );
  }

  const activeReports = input.reports.filter(
    (report) =>
      report.status !== "pending_approval" &&
      report.status !== "terminated",
  );
  const pendingHires = input.reports.filter(
    (report) => report.status === "pending_approval",
  );
  const hasPendingOrgApproval = input.pendingApprovals.some(
    (approval) =>
      approval.type === "approve_ceo_strategy" && approval.state === "pending",
  );

  if (hasPendingOrgApproval) return "awaiting_org";
  if (activeReports.length === 0 && pendingHires.length === 0) return "team_building";
  if (activeReports.length === 0 && pendingHires.length > 0) return "awaiting_hire";
  return "operating";
}
