import type { DatabaseSync } from "node:sqlite";
import { APPROVAL_STATE, type ApprovalState } from "../../shared/domain";

/** The org's autonomy: `ai_ceo` runs tasks without operator approval; `autoApproveHires` clears hire reviews. */
export function autonomy(db: DatabaseSync, orgId: string): { executionMode: string; autoApproveHires: boolean } {
  const row = db.prepare("select execution_mode, auto_approve_hires from organizations where id = ?")
    .get(orgId) as { execution_mode: string; auto_approve_hires: number } | undefined;
  if (!row) throw new Error("Organization was not found.");
  return { executionMode: row.execution_mode, autoApproveHires: row.auto_approve_hires === 1 };
}

/** The decision recorded on an approval: pending, or auto-approved by the board chair. */
export function approvalDecision(db: DatabaseSync, orgId: string, autoApprove: boolean, now: string): { state: ApprovalState; decidedBy: string | null; decidedAt: string | null } {
  if (!autoApprove) return { state: APPROVAL_STATE.PENDING, decidedBy: null, decidedAt: null };
  return { state: APPROVAL_STATE.APPROVED, decidedBy: boardChairEmployeeId(db, orgId), decidedAt: now };
}

function boardChairEmployeeId(db: DatabaseSync, orgId: string): string {
  const row = db.prepare("select id from employees where org_id = ? order by created_at asc limit 1")
    .get(orgId) as { id: string } | undefined;
  if (!row) throw new Error("Organization has no employee to record the approval decision.");
  return row.id;
}
