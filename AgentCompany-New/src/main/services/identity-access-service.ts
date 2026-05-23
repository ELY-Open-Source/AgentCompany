import type { DatabaseSync } from "node:sqlite";
import type { GrantRoleInput, SyncEmployeeIdentityInput } from "../../shared/commands";
import { ACCESS_DECISION, IDENTITY_SOURCE, ROLE_KEY, type PrincipalType, type RoleKey } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

const ROLE_KEYS = new Set(Object.values(ROLE_KEY));
const IDENTITY_SOURCES = new Set(Object.values(IDENTITY_SOURCE));
const SCOPE_TYPES = new Set(["organization", "workspace", "project", "department"]);

export class IdentityAccessService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  seedEmployeeAccess(orgId: string, employeeId: string, now: string): void {
    this.db.prepare(`
      insert into employee_identities(id, org_id, employee_id, source, external_subject, email, active, created_at, last_seen_at)
      values (?, ?, ?, ?, ?, null, 1, ?, ?)
      on conflict(org_id, source, external_subject) do nothing
    `).run(createId("eid"), orgId, employeeId, IDENTITY_SOURCE.BOOTSTRAP, employeeId, now, now);
    for (const roleKey of [ROLE_KEY.ORG_ADMIN, ROLE_KEY.APPROVAL_DECIDER, ROLE_KEY.HIRING_MANAGER]) {
      this.insertRoleGrant({
        orgId,
        principalType: "employee",
        principalId: employeeId,
        roleKey,
        scopeType: "organization",
        scopeId: orgId,
        grantedByEmployeeId: null,
        now,
      });
    }
  }

  createAgentServiceIdentity(orgId: string, agentId: string, name: string, now: string): void {
    const serviceIdentityId = createId("sid");
    this.db.prepare(`
      insert into service_identities(id, org_id, agent_id, name, scope_json, created_at)
      values (?, ?, ?, ?, ?, ?)
      on conflict(org_id, agent_id) do nothing
    `).run(serviceIdentityId, orgId, agentId, `${name.trim()} service identity`, JSON.stringify({ agentId }), now);
    const existing = this.db.prepare("select id from service_identities where org_id = ? and agent_id = ?")
      .get(orgId, agentId) as { id: string } | undefined;
    if (!existing) throw new Error("Agent service identity was not created.");
    this.insertRoleGrant({
      orgId,
      principalType: "service_identity",
      principalId: existing.id,
      roleKey: ROLE_KEY.SCOPED_AGENT,
      scopeType: "organization",
      scopeId: orgId,
      grantedByEmployeeId: null,
      now,
    });
  }

  syncEmployeeIdentity(input: SyncEmployeeIdentityInput): void {
    this.assertEmployee(input.orgId, input.employeeId, "Employee was not found.");
    if (!IDENTITY_SOURCES.has(input.source)) throw new Error("Identity source is invalid.");
    const externalSubject = input.externalSubject.trim();
    if (!externalSubject) throw new Error("External subject is required.");
    const email = input.email?.trim() || null;
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into employee_identities(id, org_id, employee_id, source, external_subject, email, active, created_at, last_seen_at)
      values (?, ?, ?, ?, ?, ?, 1, ?, ?)
      on conflict(org_id, source, external_subject) do update set
        employee_id = excluded.employee_id,
        email = excluded.email,
        active = 1,
        last_seen_at = excluded.last_seen_at
    `).run(createId("eid"), input.orgId, input.employeeId, input.source, externalSubject, email, now, now);
    this.audit.record({
      orgId: input.orgId,
      entityType: "employee_identity",
      entityId: input.employeeId,
      actorType: "system",
      actorId: null,
      action: "synced",
      payload: { source: input.source, externalSubject, email },
    });
  }

  grantRole(input: GrantRoleInput): void {
    this.assertEmployee(input.orgId, input.grantedByEmployeeId, "Granting employee was not found.");
    this.assertEmployeeRole(input.orgId, input.grantedByEmployeeId, ROLE_KEY.ORG_ADMIN, "role_grant", input.scopeType, input.scopeId);
    if (!ROLE_KEYS.has(input.roleKey)) throw new Error("Role key is invalid.");
    if (!SCOPE_TYPES.has(input.scopeType)) throw new Error("Role scope type is invalid.");
    this.assertPrincipal(input.orgId, input.principalType, input.principalId);
    const now = new Date().toISOString();
    const changes = this.insertRoleGrant({ ...input, now });
    if (changes > 0) {
      this.audit.record({
        orgId: input.orgId,
        entityType: "role_grant",
        entityId: input.principalId,
        actorType: "employee",
        actorId: input.grantedByEmployeeId,
        action: "granted",
        payload: { principalType: input.principalType, roleKey: input.roleKey, scopeType: input.scopeType, scopeId: input.scopeId },
      });
    }
  }

  assertEmployeeRole(
    orgId: string,
    employeeId: string,
    roleKey: RoleKey,
    action: string,
    resourceType: string,
    resourceId: string,
    employeeMissingMessage = "Employee was not found.",
  ): void {
    this.assertEmployee(orgId, employeeId, employeeMissingMessage);
    const allowed = this.hasRole(orgId, "employee", employeeId, roleKey) || this.hasRole(orgId, "employee", employeeId, ROLE_KEY.ORG_ADMIN);
    this.recordDecision(orgId, "employee", employeeId, action, resourceType, resourceId, allowed, allowed ? roleKey : "missing_role");
    if (!allowed) throw new Error(`Employee requires ${roleKey} role.`);
  }

  private hasRole(orgId: string, principalType: PrincipalType, principalId: string, roleKey: RoleKey): boolean {
    const row = this.db.prepare(`
      select id from role_grants
      where org_id = ? and principal_type = ? and principal_id = ? and role_key = ?
      limit 1
    `).get(orgId, principalType, principalId, roleKey);
    return Boolean(row);
  }

  private insertRoleGrant(input: {
    orgId: string; principalType: PrincipalType; principalId: string; roleKey: RoleKey;
    scopeType: string; scopeId: string; grantedByEmployeeId: string | null; now: string;
  }): number {
    const result = this.db.prepare(`
      insert into role_grants(id, org_id, principal_type, principal_id, role_key, scope_type, scope_id, granted_by_employee_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(org_id, principal_type, principal_id, role_key, scope_type, scope_id) do nothing
    `).run(createId("rgr"), input.orgId, input.principalType, input.principalId, input.roleKey, input.scopeType, input.scopeId, input.grantedByEmployeeId, input.now);
    return Number(result.changes);
  }

  private assertPrincipal(orgId: string, principalType: PrincipalType, principalId: string): void {
    if (principalType === "employee") this.assertEmployee(orgId, principalId, "Employee was not found.");
    else if (principalType === "agent") this.assertAgent(orgId, principalId);
    else if (principalType === "service_identity") this.assertServiceIdentity(orgId, principalId);
    else throw new Error("Principal type is invalid.");
  }

  private assertEmployee(orgId: string, employeeId: string, message: string): void {
    const row = this.db.prepare("select id from employees where id = ? and org_id = ?").get(employeeId, orgId);
    if (!row) throw new Error(message);
  }

  private assertAgent(orgId: string, agentId: string): void {
    const row = this.db.prepare("select id from agents where id = ? and org_id = ?").get(agentId, orgId);
    if (!row) throw new Error("Agent was not found.");
  }

  private assertServiceIdentity(orgId: string, serviceIdentityId: string): void {
    const row = this.db.prepare("select id from service_identities where id = ? and org_id = ?").get(serviceIdentityId, orgId);
    if (!row) throw new Error("Service identity was not found.");
  }

  private recordDecision(
    orgId: string,
    principalType: PrincipalType,
    principalId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    allowed: boolean,
    reason: string,
  ): void {
    this.db.prepare(`
      insert into access_decisions(id, org_id, principal_type, principal_id, action, resource_type, resource_id, decision, reason, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createId("acd"), orgId, principalType, principalId, action, resourceType, resourceId, allowed ? ACCESS_DECISION.ALLOW : ACCESS_DECISION.DENY, reason, new Date().toISOString());
  }
}
