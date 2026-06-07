import type { DatabaseSync } from "node:sqlite";
import type { CreateApprovalInput, DecideApprovalInput } from "../../shared/commands";
import { APPROVAL_STATE, ROLE_KEY } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { IdentityAccessService } from "./identity-access-service";
import { OrgGovernanceService } from "./org-governance-service";

interface ApprovalAuditContext {
  sourceMessageId?: string;
  sourceThreadId?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
}

export class ApprovalService {
  private readonly audit: AuditService;
  private readonly identityAccess: IdentityAccessService;
  private readonly governance: OrgGovernanceService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.identityAccess = new IdentityAccessService(db);
    this.governance = new OrgGovernanceService(db);
  }

  create(input: CreateApprovalInput, context: ApprovalAuditContext = {}): string {
    this.assertRequesterBelongsToOrg(input);
    const kind = input.kind.trim();
    const title = input.title.trim();
    const details = input.details.trim();
    if (!kind) throw new Error("Approval kind is required.");
    if (!title) throw new Error("Approval title is required.");
    if (!details) throw new Error("Approval details are required.");
    const id = createId("app");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into approvals(
        id, org_id, kind, title, details, risk, requested_by_type, requested_by_id,
        source_entity_type, source_entity_id, state, decided_by_employee_id, created_at, decided_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      kind,
      title,
      details,
      input.risk,
      input.requestedByType,
      input.requestedById,
      context.sourceEntityType ?? null,
      context.sourceEntityId ?? null,
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
      payload: { kind, risk: input.risk, ...context },
    });
    this.governance.routeApproval({ orgId: input.orgId, approvalId: id, kind, risk: input.risk });
    return id;
  }

  decide(input: DecideApprovalInput): void {
    this.identityAccess.assertEmployeeRole(
      input.orgId,
      input.decidedByEmployeeId,
      ROLE_KEY.APPROVAL_DECIDER,
      "approval_decide",
      "approval",
      input.approvalId,
      "Deciding employee was not found.",
    );
    const now = new Date().toISOString();
    const notes = input.notes?.trim() || null;
    const result = this.db.prepare(`
      update approvals
      set state = ?, decided_by_employee_id = ?, decided_at = ?, decision_notes = ?
      where id = ? and org_id = ? and state = ?
    `).run(input.state, input.decidedByEmployeeId, now, notes, input.approvalId, input.orgId, APPROVAL_STATE.PENDING);
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

  private assertRequesterBelongsToOrg(input: CreateApprovalInput): void {
    if (input.requestedByType === "employee") {
      if (!input.requestedById) throw new Error("Requesting employee is required.");
      this.assertEmployee(input.orgId, input.requestedById, "Requesting employee was not found.");
      return;
    }
    if (input.requestedByType === "agent") {
      if (!input.requestedById) throw new Error("Requesting agent is required.");
      const agent = this.db.prepare("select id from agents where id = ? and org_id = ?").get(input.requestedById, input.orgId);
      if (!agent) throw new Error("Requesting agent was not found.");
      return;
    }
    if (input.requestedByType === "system" && input.requestedById) {
      throw new Error("System approvals cannot include a requester id.");
    }
  }

  private assertEmployee(orgId: string, employeeId: string, message: string): void {
    const employee = this.db.prepare("select id from employees where id = ? and org_id = ?").get(employeeId, orgId);
    if (!employee) throw new Error(message);
  }
}
