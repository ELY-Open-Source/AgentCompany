import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ApprovalService } from "../../src/main/services/approval-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { RISK_LEVEL } from "../../src/shared/domain";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-governance-${randomUUID()}.db`));
}

function createOrganization(organization: OrganizationService): string {
  return organization.createOrganization({
    organizationName: "Acme Operations",
    employeeName: "Dana Lee",
    mission: "Coordinate agents with auditable approvals.",
    goal: "Ship a verified control plane.",
  });
}

describe("org governance service", () => {
  test("enforces department hiring budget policy before creating agents", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    let orgId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      connection.db.prepare(`
        update hiring_policies
        set monthly_budget_limit_cents = ?
        where org_id = ? and department_name = ?
      `).run(10000, orgId, "Engineering");
    });

    expect(() => connection.transaction(() => organization.createAgent({
      orgId,
      name: "Ada",
      role: "Reviewer",
      department: "Engineering",
      modelProviderId: null,
      modelId: null,
      budgetCents: 10001,
      managerAgentId: null,
    }))).toThrow("Department monthly budget limit has been reached.");
    expect(connection.db.prepare("select count(*) as count from agents where org_id = ?").get(orgId)).toEqual({ count: 0 });
    connection.close();
  });

  test("routes created approvals to the configured review assignee", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const approvals = new ApprovalService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let approvalId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
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

    const state = snapshot.load();
    expect(state.approvalAssignments).toHaveLength(1);
    expect(state.approvalAssignments[0]).toMatchObject({ approvalId, assigneeType: "employee" });
    expect(state.auditEvents.some((event) => event.entityType === "approval" && event.action === "routed")).toBe(true);
    connection.close();
  });

  test("routes high budget hires to the configured review assignee", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
        autoApproveHires: false,
      });
      organization.createAgent({
        orgId,
        name: "Ada",
        role: "Reviewer",
        department: "Engineering",
        modelProviderId: null,
        modelId: null,
        budgetCents: 600000,
        managerAgentId: null,
      });
    });

    const state = snapshot.load();
    const approval = state.approvals.find((item) => item.kind === "agent_hire");
    expect(approval).toMatchObject({ orgId, title: "Review hire: Ada", risk: RISK_LEVEL.MEDIUM });
    expect(state.approvalAssignments).toHaveLength(1);
    expect(state.approvalAssignments[0]).toMatchObject({ approvalId: approval?.id, assigneeType: "employee" });
    connection.close();
  });
});
