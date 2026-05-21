import type { DatabaseSync } from "node:sqlite";
import type { CreateApprovalInput, DecideApprovalInput } from "../../shared/commands";
import { APPROVAL_STATE } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

export class ApprovalService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  create(input: CreateApprovalInput): string {
    const id = createId("app");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into approvals(
        id, org_id, kind, title, details, risk, requested_by_type, requested_by_id,
        state, decided_by_employee_id, created_at, decided_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      input.kind.trim(),
      input.title.trim(),
      input.details.trim(),
      input.risk,
      input.requestedByType,
      input.requestedById,
      APPROVAL_STATE.PENDING,
      null,
      now,
      null,
    );
    this.audit.record({
      orgId: input.orgId,
      entityType: "approval",
      entityId: id,
      actorType: input.requestedByType,
      actorId: input.requestedById,
      action: "requested",
      payload: { kind: input.kind, risk: input.risk },
    });
    return id;
  }

  decide(input: DecideApprovalInput): void {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      update approvals
      set state = ?, decided_by_employee_id = ?, decided_at = ?
      where id = ? and org_id = ? and state = ?
    `).run(input.state, input.decidedByEmployeeId, now, input.approvalId, input.orgId, APPROVAL_STATE.PENDING);
    if (result.changes === 0) throw new Error("Pending approval was not found.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "approval",
      entityId: input.approvalId,
      actorType: "employee",
      actorId: input.decidedByEmployeeId,
      action: input.state,
      payload: { decidedAt: now },
    });
  }
}
