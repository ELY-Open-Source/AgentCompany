import { tableRows } from "../helpers/table-rows";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ApprovalService } from "../../src/main/services/approval-service";
import { IdentityAccessService } from "../../src/main/services/identity-access-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { RISK_LEVEL, ROLE_KEY } from "../../src/shared/domain";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-identity-${randomUUID()}.db`));
}

function createOrganization(organization: OrganizationService): string {
  return organization.createOrganization({
    organizationName: "Acme Operations",
    employeeName: "Dana Lee",
    mission: "Coordinate agents with auditable approvals.",
    goal: "Ship a verified control plane.",
  });
}

function firstEmployeeId(connection: DatabaseConnection, orgId: string): string {
  return (connection.db.prepare("select id from employees where org_id = ? order by created_at asc limit 1")
    .get(orgId) as { id: string }).id;
}

describe("identity access service", () => {
  test("syncs SSO employee identities and grants scoped roles", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const identityAccess = new IdentityAccessService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      employeeId = firstEmployeeId(connection, orgId);
      identityAccess.syncEmployeeIdentity({
        orgId,
        employeeId,
        source: "sso",
        externalSubject: "okta-00u1",
        email: "dana@example.com",
      });
      identityAccess.grantRole({
        orgId,
        principalType: "employee",
        principalId: employeeId,
        roleKey: ROLE_KEY.APPROVAL_DECIDER,
        scopeType: "organization",
        scopeId: orgId,
        grantedByEmployeeId: employeeId,
      });
    });

    const state = snapshot.load();
    expect(tableRows(connection.db, "employee_identities", "created_at desc", ["active"]).some((identity) => identity.source === "sso" && identity.email === "dana@example.com")).toBe(true);
    expect(tableRows(connection.db, "role_grants", "created_at desc").some((grant) => grant.principalId === employeeId && grant.roleKey === ROLE_KEY.APPROVAL_DECIDER)).toBe(true);
    expect(state.auditEvents.some((event) => event.entityType === "employee_identity" && event.action === "synced")).toBe(true);
    connection.close();
  });

  test("records denied access decisions when approval decider role is missing", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const approvals = new ApprovalService(connection.db);
    let orgId = "";
    let employeeId = "";
    let approvalId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      employeeId = firstEmployeeId(connection, orgId);
      connection.db.prepare("delete from role_grants where org_id = ? and principal_id = ?").run(orgId, employeeId);
      approvalId = approvals.create({
        orgId,
        kind: "release",
        title: "Release approval",
        details: "Approve release train.",
        risk: RISK_LEVEL.MEDIUM,
        requestedByType: "system",
        requestedById: null,
      });
    });

    expect(() => approvals.decide({
      orgId,
      approvalId,
      state: "approved",
      decidedByEmployeeId: employeeId,
    })).toThrow("Employee requires approval_decider role.");
    expect(connection.db.prepare("select decision, reason from access_decisions where org_id = ?").all(orgId))
      .toEqual([{ decision: "deny", reason: "missing_role" }]);
    connection.close();
  });
});
