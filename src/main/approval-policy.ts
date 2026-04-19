import type { AppDatabase } from "./database";

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
  const note = decisionNote ?? "";
  db.decideApproval({
    companyId,
    approvalId,
    state,
    decisionNote: note,
  });
  db.addActivity({
    companyId,
    actor,
    action: `approval.${state}`,
    entityType: "approval",
    entityId: approvalId,
    detail: detail ?? note,
  });
  handleApprovalResolved(approvalId, companyId, state);
}
