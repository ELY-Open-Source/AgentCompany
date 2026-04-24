/**
 * Execution Policy
 *
 * Runtime decisions read the seeded approval_policies table. The exported
 * constants below exist for prompt/docs contracts that need the same seed
 * vocabulary without opening SQLite.
 */

import type { AppDatabase } from "./database";
import type { ApprovalType, ExecutionMode } from "@shared/types";
export {
  APPROVAL_POLICY_SEED,
  COFOUNDER_MANDATORY_APPROVAL_TYPES,
  OPERATIONAL_APPROVAL_TYPES,
} from "./approval-policy-definitions";
import {
  COFOUNDER_MANDATORY_APPROVAL_TYPES,
  OPERATIONAL_APPROVAL_TYPES,
} from "./approval-policy-definitions";

function assertExecutionMode(value: string): asserts value is ExecutionMode {
  if (value !== "ai_ceo" && value !== "ai_cofounder") {
    throw new Error(`Invalid execution mode returned from database: ${value}`);
  }
}

const COFOUNDER_MANDATORY_APPROVALS = new Set<ApprovalType>(COFOUNDER_MANDATORY_APPROVAL_TYPES);

export function isCofounderMandatoryApproval(approvalType: string): approvalType is ApprovalType {
  return COFOUNDER_MANDATORY_APPROVALS.has(approvalType as ApprovalType);
}

const OPERATIONAL_APPROVALS = new Set<ApprovalType>(OPERATIONAL_APPROVAL_TYPES);

export function isOperationalApproval(approvalType: string): approvalType is ApprovalType {
  return OPERATIONAL_APPROVALS.has(approvalType as ApprovalType);
}

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
  const policy = db.core.approvals.getApprovalPolicy(approvalType);
  if (!policy?.autoApprovable) {
    return false;
  }

  if (mode === "ai_cofounder" && policy.requiredMode === "ai_cofounder") {
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
