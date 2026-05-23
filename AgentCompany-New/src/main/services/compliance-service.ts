import type { DatabaseSync } from "node:sqlite";
import type {
  CreateComplianceExportInput,
  CreateLegalHoldInput,
  CreateRetentionFreezeInput,
  SetLegalHoldStateInput,
  SetRetentionFreezeStateInput,
} from "../../shared/commands";
import { COMPLIANCE_EXPORT_STATE, COMPLIANCE_EXPORT_TYPE } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

type Row = Record<string, unknown>;

export class ComplianceService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  createExport(input: CreateComplianceExportInput): string {
    this.assertOrg(input.orgId);
    this.assertEmployee(input.orgId, input.requestedByEmployeeId, "Requesting employee was not found.");
    this.assertSubject(input.orgId, input.subjectType, input.subjectId);
    if (input.exportType === COMPLIANCE_EXPORT_TYPE.GDPR_DELETE) this.assertDeleteAllowed(input);
    const payload = this.subjectPayload(input.orgId, input.subjectType, input.subjectId);
    if (input.exportType === COMPLIANCE_EXPORT_TYPE.GDPR_DELETE) this.applyGdprDelete(input.orgId, input.subjectType, input.subjectId);
    const id = createId("cmp");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into compliance_exports(
        id, org_id, subject_type, subject_id, export_type, state, payload_json,
        requested_by_employee_id, created_at, completed_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      input.subjectType,
      input.subjectId,
      input.exportType,
      COMPLIANCE_EXPORT_STATE.COMPLETED,
      JSON.stringify(payload),
      input.requestedByEmployeeId,
      now,
      now,
    );
    this.audit.record({
      orgId: input.orgId,
      entityType: "compliance_export",
      entityId: id,
      actorType: "employee",
      actorId: input.requestedByEmployeeId,
      action: input.exportType === COMPLIANCE_EXPORT_TYPE.GDPR_DELETE ? "gdpr_deleted" : "created",
      payload: { subjectType: input.subjectType, subjectId: input.subjectId, exportType: input.exportType },
    });
    return id;
  }

  createLegalHold(input: CreateLegalHoldInput): string {
    const reason = input.reason.trim();
    if (!reason) throw new Error("Legal hold reason is required.");
    this.assertOrg(input.orgId);
    this.assertEmployee(input.orgId, input.createdByEmployeeId, "Legal hold employee was not found.");
    this.assertHoldEntity(input.orgId, input.entityType, input.entityId);
    const id = createId("hold");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into legal_holds(id, org_id, entity_type, entity_id, reason, created_by_employee_id, active, created_at, released_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.entityType, input.entityId, reason, input.createdByEmployeeId, 1, now, null);
    this.audit.record({
      orgId: input.orgId,
      entityType: "legal_hold",
      entityId: id,
      actorType: "employee",
      actorId: input.createdByEmployeeId,
      action: "created",
      payload: { entityType: input.entityType, entityId: input.entityId },
    });
    return id;
  }

  setLegalHoldState(input: SetLegalHoldStateInput): void {
    this.assertEmployee(input.orgId, input.employeeId, "Legal hold employee was not found.");
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      update legal_holds
      set active = ?, released_at = ?
      where id = ? and org_id = ?
    `).run(input.active ? 1 : 0, input.active ? null : now, input.legalHoldId, input.orgId);
    if (result.changes === 0) throw new Error("Legal hold was not found.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "legal_hold",
      entityId: input.legalHoldId,
      actorType: "employee",
      actorId: input.employeeId,
      action: input.active ? "activated" : "released",
      payload: { active: input.active },
    });
  }

  createRetentionFreeze(input: CreateRetentionFreezeInput): string {
    const reason = input.reason.trim();
    if (!reason) throw new Error("Retention freeze reason is required.");
    this.assertOrg(input.orgId);
    this.assertEmployee(input.orgId, input.createdByEmployeeId, "Retention freeze employee was not found.");
    this.assertFreezeScope(input.orgId, input.scopeType, input.scopeId);
    const id = createId("frz");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into retention_freezes(id, org_id, scope_type, scope_id, reason, created_by_employee_id, active, created_at, released_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.scopeType, input.scopeId, reason, input.createdByEmployeeId, 1, now, null);
    this.audit.record({
      orgId: input.orgId,
      entityType: "retention_freeze",
      entityId: id,
      actorType: "employee",
      actorId: input.createdByEmployeeId,
      action: "created",
      payload: { scopeType: input.scopeType, scopeId: input.scopeId },
    });
    return id;
  }

  setRetentionFreezeState(input: SetRetentionFreezeStateInput): void {
    this.assertEmployee(input.orgId, input.employeeId, "Retention freeze employee was not found.");
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      update retention_freezes
      set active = ?, released_at = ?
      where id = ? and org_id = ?
    `).run(input.active ? 1 : 0, input.active ? null : now, input.retentionFreezeId, input.orgId);
    if (result.changes === 0) throw new Error("Retention freeze was not found.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "retention_freeze",
      entityId: input.retentionFreezeId,
      actorType: "employee",
      actorId: input.employeeId,
      action: input.active ? "activated" : "released",
      payload: { active: input.active },
    });
  }

  private subjectPayload(orgId: string, subjectType: string, subjectId: string): Record<string, unknown> {
    if (subjectType === "employee") {
      return {
        profile: this.one("employees", orgId, subjectId),
        chatMessages: this.db.prepare("select * from chat_messages where org_id = ? and sender_type = 'employee' and sender_id = ? order by created_at").all(orgId, subjectId),
        approvalsRequested: this.db.prepare("select * from approvals where org_id = ? and requested_by_type = 'employee' and requested_by_id = ? order by created_at").all(orgId, subjectId),
        approvalsDecided: this.db.prepare("select * from approvals where org_id = ? and decided_by_employee_id = ? order by created_at").all(orgId, subjectId),
        auditEventsAsActor: this.db.prepare("select * from audit_events where org_id = ? and actor_type = 'employee' and actor_id = ? order by created_at").all(orgId, subjectId),
      };
    }
    return {
      profile: this.one("agents", orgId, subjectId),
      tasks: this.db.prepare("select * from tasks where org_id = ? and assignee_agent_id = ? order by created_at").all(orgId, subjectId),
      taskRuns: this.db.prepare("select * from task_runs where org_id = ? and agent_id = ? order by created_at").all(orgId, subjectId),
      chatMessages: this.db.prepare("select * from chat_messages where org_id = ? and sender_type = 'agent' and sender_id = ? order by created_at").all(orgId, subjectId),
      auditEventsAsActor: this.db.prepare("select * from audit_events where org_id = ? and actor_type = 'agent' and actor_id = ? order by created_at").all(orgId, subjectId),
    };
  }

  private applyGdprDelete(orgId: string, subjectType: string, subjectId: string): void {
    if (subjectType === "employee") {
      this.db.prepare("update employees set display_name = ?, role = ? where id = ? and org_id = ?")
        .run("Deleted employee", "Deleted", subjectId, orgId);
      this.db.prepare("update chat_messages set sender_id = null where org_id = ? and sender_type = 'employee' and sender_id = ?")
        .run(orgId, subjectId);
      this.db.prepare("update approvals set requested_by_id = null where org_id = ? and requested_by_type = 'employee' and requested_by_id = ?")
        .run(orgId, subjectId);
      return;
    }
    this.db.prepare("update agents set name = ?, role = ?, lifecycle = ?, model_provider_id = null, model_id = null where id = ? and org_id = ?")
      .run("Deleted agent", "Deleted", "archived", subjectId, orgId);
    this.db.prepare("update tasks set assignee_agent_id = null where org_id = ? and assignee_agent_id = ?").run(orgId, subjectId);
    this.db.prepare("update task_runs set agent_id = null where org_id = ? and agent_id = ?").run(orgId, subjectId);
    this.db.prepare("update chat_messages set sender_id = null where org_id = ? and sender_type = 'agent' and sender_id = ?")
      .run(orgId, subjectId);
  }

  private assertDeleteAllowed(input: CreateComplianceExportInput): void {
    const legalHold = this.db.prepare(`
      select id from legal_holds
      where org_id = ? and active = 1
        and ((entity_type = ? and entity_id = ?) or (entity_type = 'organization' and entity_id = ?))
      limit 1
    `).get(input.orgId, input.subjectType, input.subjectId, input.orgId);
    const retentionFreeze = this.db.prepare(`
      select id from retention_freezes
      where org_id = ? and active = 1 and scope_type = 'organization' and scope_id = ?
      limit 1
    `).get(input.orgId, input.orgId);
    if (legalHold || retentionFreeze) throw new Error("Active compliance hold prevents GDPR delete.");
  }

  private one(table: "employees" | "agents", orgId: string, id: string): Row {
    const row = this.db.prepare(`select * from ${table} where id = ? and org_id = ?`).get(id, orgId) as Row | undefined;
    if (!row) throw new Error("Compliance subject was not found.");
    return row;
  }

  private assertSubject(orgId: string, subjectType: string, subjectId: string): void {
    if (subjectType === "employee") return void this.assertEmployee(orgId, subjectId, "Compliance subject was not found.");
    if (subjectType === "agent") return void this.assertAgent(orgId, subjectId, "Compliance subject was not found.");
    throw new Error(`Unsupported compliance subject type: ${subjectType}`);
  }

  private assertHoldEntity(orgId: string, entityType: string, entityId: string): void {
    if (entityType === "organization" && entityId === orgId) return;
    if (entityType === "employee") return void this.assertEmployee(orgId, entityId, "Legal hold entity was not found.");
    if (entityType === "agent") return void this.assertAgent(orgId, entityId, "Legal hold entity was not found.");
    if (entityType === "chat_thread") return void this.assertOrgEntity("chat_threads", orgId, entityId, "Legal hold entity was not found.");
    if (entityType === "file_object") return void this.assertOrgEntity("file_objects", orgId, entityId, "Legal hold entity was not found.");
    throw new Error(`Unsupported legal hold entity type: ${entityType}`);
  }

  private assertFreezeScope(orgId: string, scopeType: string, scopeId: string): void {
    if (scopeType === "organization" && scopeId === orgId) return;
    if (scopeType === "chat_space") return void this.assertOrgEntity("chat_spaces", orgId, scopeId, "Retention freeze scope was not found.");
    if (scopeType === "file_object") return void this.assertOrgEntity("file_objects", orgId, scopeId, "Retention freeze scope was not found.");
    throw new Error(`Unsupported retention freeze scope type: ${scopeType}`);
  }

  private assertOrg(orgId: string): void {
    const row = this.db.prepare("select id from organizations where id = ?").get(orgId);
    if (!row) throw new Error("Organization was not found.");
  }

  private assertEmployee(orgId: string, employeeId: string, message: string): void {
    this.assertOrgEntity("employees", orgId, employeeId, message);
  }

  private assertAgent(orgId: string, agentId: string, message: string): void {
    this.assertOrgEntity("agents", orgId, agentId, message);
  }

  private assertOrgEntity(table: "employees" | "agents" | "chat_threads" | "file_objects" | "chat_spaces", orgId: string, id: string, message: string): void {
    const row = this.db.prepare(`select id from ${table} where id = ? and org_id = ?`).get(id, orgId);
    if (!row) throw new Error(message);
  }
}
