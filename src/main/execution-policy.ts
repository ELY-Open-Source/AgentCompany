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

function assertExecutionMode(value: string): asserts value is ExecutionMode {
  if (value !== "ai_ceo" && value !== "ai_cofounder") {
    throw new Error(`Invalid execution mode returned from database: ${value}`);
  }
}

/** Approval types that always require human review in co-founder mode. */
export const COFOUNDER_MANDATORY_APPROVAL_TYPES = [
  "deliverable_review",
  "document_review",
  "plan_review",
  "scope_review",
  "draft_review",
  "strategy_review",
  "exception_review",
  "approve_ceo_strategy",
  "production_deploy",
] as const satisfies readonly ApprovalType[];

const COFOUNDER_MANDATORY_APPROVALS = new Set<ApprovalType>(COFOUNDER_MANDATORY_APPROVAL_TYPES);

export function isCofounderMandatoryApproval(approvalType: string): approvalType is ApprovalType {
  return COFOUNDER_MANDATORY_APPROVALS.has(approvalType as ApprovalType);
}

/** Approval types that always gate destructive tools while pending. */
export const OPERATIONAL_APPROVAL_TYPES = [
  "dangerous_command",
  "secret_access",
  "production_deploy",
  "social_post",
  "budget_override",
] as const satisfies readonly ApprovalType[];

const OPERATIONAL_APPROVALS = new Set<ApprovalType>(OPERATIONAL_APPROVAL_TYPES);

export function isOperationalApproval(approvalType: string): approvalType is ApprovalType {
  return OPERATIONAL_APPROVALS.has(approvalType as ApprovalType);
}

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
  const rawMode = db.core.company.getCompanyExecutionMode(companyId);
  assertExecutionMode(rawMode);
  const mode = rawMode;

  // Co-founder mode: mandatory types always require human decision
  if (mode === "ai_cofounder" && isCofounderMandatoryApproval(approvalType)) {
    return false;
  }

  // Only specific types are ever auto-approvable
  if (!CEO_AUTO_APPROVABLE.has(approvalType as ApprovalType)) {
    return false;
  }

  const settings = db.core.company.getCompanyApprovalSettings(companyId);
  if (!settings?.autoApproveHires) return false;

  // When reviewDeliverables is ON, CEO strategy needs human review
  if (approvalType === "approve_ceo_strategy" && settings.reviewDeliverables) {
    return false;
  }

  return true;
}
