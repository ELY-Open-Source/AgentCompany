/**
 * Execution Policy — Single Source of Truth
 *
 * Centralizes all execution-mode-aware policy decisions:
 * - Which approval types require human review in co-founder mode
 * - Which approval types can be auto-approved in CEO mode
 * - Whether a given approval should be auto-approved based on mode + company settings
 *
 * checkpoint-engine.ts and approval-policy.ts both delegate here
 * instead of maintaining separate rule sets.
 */

import type { AppDatabase } from "./database";
import type { ApprovalType, ExecutionMode } from "@shared/types";

/** Approval types that always require human review in co-founder mode. */
const COFOUNDER_MANDATORY_APPROVALS = new Set<ApprovalType>([
  "deliverable_review",
  "document_review",
  "plan_review",
  "scope_review",
  "draft_review",
  "strategy_review",
  "exception_review",
  "approve_ceo_strategy",
  "production_deploy",
]);

/** Approval types eligible for auto-approval in CEO mode (when company settings allow). */
const CEO_AUTO_APPROVABLE = new Set<ApprovalType>([
  "hire_agent",
  "approve_ceo_strategy",
]);

/** Task types that get plan_review checkpoints in co-founder mode. */
export const CHECKPOINT_TASK_TYPES = new Set(["research", "content", "management"]);

/** Document types that get strategy_review instead of draft_review. */
export const STRATEGY_DOCUMENT_TYPES = new Set(["project_brief", "proposal", "budget_proposal"]);

/**
 * Determines whether an approval should be auto-approved.
 * This is the single decision function — no other module should
 * independently decide auto-approval policy.
 */
export function shouldAutoApprove(
  db: AppDatabase,
  companyId: string,
  approvalType: string,
): boolean {
  const mode = db.getCompanyExecutionMode(companyId) as ExecutionMode;

  // Co-founder mode: mandatory types always require human decision
  if (mode === "ai_cofounder" && COFOUNDER_MANDATORY_APPROVALS.has(approvalType as ApprovalType)) {
    return false;
  }

  // Only specific types are ever auto-approvable
  if (!CEO_AUTO_APPROVABLE.has(approvalType as ApprovalType)) {
    return false;
  }

  const settings = db.getCompanyApprovalSettings(companyId);
  if (!settings?.autoApproveHires) return false;

  // When reviewDeliverables is ON, CEO strategy needs human review
  if (approvalType === "approve_ceo_strategy" && settings.reviewDeliverables) {
    return false;
  }

  return true;
}
