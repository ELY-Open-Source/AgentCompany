import type { AppDatabase } from "./database";

const AUTO_APPROVAL_TYPES = new Set(["hire_agent", "approve_ceo_strategy"]);

export function shouldAutoApproveApproval(
  db: AppDatabase,
  companyId: string,
  approvalType: string,
): boolean {
  if (!AUTO_APPROVAL_TYPES.has(approvalType)) {
    return false;
  }

  return db
    .listSnapshot()
    .companies
    .some((company) => company.id === companyId && company.autoApproveHires);
}

export function resolveApprovalDecision({
  db,
  handleApprovalResolved,
  companyId,
  approvalId,
  state,
  decisionNote,
  detail,
  actor = "board",
}: {
  db: AppDatabase;
  handleApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
  companyId: string;
  approvalId: string;
  state: "approved" | "rejected" | "revision_requested";
  decisionNote?: string;
  detail?: string | null;
  actor?: string;
}) {
  db.decideApproval({
    companyId,
    approvalId,
    state,
    decisionNote: decisionNote ?? "",
  });
  db.addActivity({
    companyId,
    actor,
    action: `approval.${state}`,
    entityType: "approval",
    entityId: approvalId,
    detail: detail ?? decisionNote ?? "",
  });
  handleApprovalResolved(approvalId, companyId, state);
}
