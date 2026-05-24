import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ApprovalService } from "../../src/main/services/approval-service";
import { FileService } from "../../src/main/services/file-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { SocialService } from "../../src/main/services/social-service";
import { APPROVAL_STATE, ROUTE_TO_TYPE, SOCIAL_PLATFORM } from "../../src/shared/domain";
import { createId } from "../../src/shared/ids";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-social-${randomUUID()}.db`));
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
  return (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
}

function createEmployee(connection: DatabaseConnection, orgId: string, displayName: string): string {
  const id = createId("emp");
  connection.db.prepare(`
    insert into employees(id, org_id, display_name, role, created_at)
    values (?, ?, ?, ?, ?)
  `).run(id, orgId, displayName, "operator", new Date().toISOString());
  return id;
}

describe("social service", () => {
  test("creates social accounts with scoped employee grants", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const social = new SocialService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let employeeId = "";

    connection.transaction(() => {
      const orgId = createOrganization(organization);
      employeeId = firstEmployeeId(connection, orgId);
      social.createAccount({
        orgId,
        platform: SOCIAL_PLATFORM.X,
        handle: "@acme",
        displayName: "Acme",
        createdByEmployeeId: employeeId,
        authorizedEmployeeId: employeeId,
      });
    });

    const state = snapshot.load();
    const grantScope = JSON.parse(state.socialAccountGrants[0]!.scopeJson) as { actions: string[]; riskCeiling: string };
    expect(state.socialAccounts).toHaveLength(1);
    expect(state.socialAccountGrants[0]?.employeeId).toBe(employeeId);
    expect(state.browserSessionContainers[0]).toMatchObject({
      socialAccountId: state.socialAccounts[0]?.id,
      platform: SOCIAL_PLATFORM.X,
      permissionPolicy: "deny_all",
      sandboxEnabled: true,
    });
    expect(JSON.parse(state.browserSessionContainers[0]!.hostAllowlistJson)).toEqual(["x.com", "twitter.com"]);
    expect(state.browserActionPolicies.map((policy) => policy.actionType).sort()).toEqual(["approve", "draft", "login"]);
    expect(state.browserActionPolicies.find((policy) => policy.actionType === "approve")).toMatchObject({
      approvalRequired: true,
      approvalKind: "social_publish",
      riskLevel: "medium",
    });
    expect(state.socialApprovalRoutes[0]).toMatchObject({
      socialAccountId: state.socialAccounts[0]?.id,
      actionType: "approve",
      approvalKind: "social_publish",
      routeToId: employeeId,
    });
    expect(state.socialAuditRecords[0]).toMatchObject({
      socialAccountId: state.socialAccounts[0]?.id,
      sourceType: "social_account",
      eventType: "account_created",
      actorType: "employee",
      actorId: employeeId,
      policyDecision: "allowed_employee_authorization",
    });
    expect(state.auditEvents.find((event) => event.entityType === "social_account")?.actorId).toBe(employeeId);
    expect(grantScope.actions).toEqual(["login", "draft", "approve"]);
    expect(grantScope.riskCeiling).toBe("medium");
    connection.close();
  });

  test("pins files and schedules social posts behind approval", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const social = new SocialService(connection.db);
    const approvals = new ApprovalService(connection.db);
    const files = new FileService(connection.db, join(tmpdir(), `artifacts-${randomUUID()}`));
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let socialAccountId = "";
    let postId = "";
    let employeeId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      employeeId = firstEmployeeId(connection, orgId);
      socialAccountId = social.createAccount({
        orgId,
        platform: SOCIAL_PLATFORM.X,
        handle: "@acme",
        displayName: "Acme",
        createdByEmployeeId: employeeId,
        authorizedEmployeeId: employeeId,
      });
      const fileId = createId("fil");
      connection.db.prepare(`
        insert into file_objects(
          id, org_id, name, kind, size_bytes, sha256, storage_path,
          owner_type, owner_id, space_id, pinned, created_at, updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, orgId, "launch-thread.md", "md", 256, "abc", "artifacts/launch-thread.md", "employee", employeeId, null, 0, new Date().toISOString(), new Date().toISOString());
      files.setPinned(orgId, fileId, true);
      postId = social.createScheduledPost({
        orgId,
        socialAccountId,
        bodyMd: "Pilot starts Friday.",
        scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        createdByEmployeeId: employeeId,
      });
    });

    connection.transaction(() => {
      social.setScheduledPostState({ orgId, scheduledPostId: postId, state: "scheduled", employeeId });
    });

    expect(() => connection.transaction(() => social.setScheduledPostState({
      orgId,
      scheduledPostId: postId,
      state: "published",
      employeeId,
    }))).toThrow("Approved social approval is required.");

    connection.transaction(() => {
      const approvalId = (connection.db.prepare("select approval_id from scheduled_posts where id = ?")
        .get(postId) as { approval_id: string }).approval_id;
      approvals.decide({ orgId, approvalId, state: APPROVAL_STATE.APPROVED, decidedByEmployeeId: employeeId });
      social.setScheduledPostState({ orgId, scheduledPostId: postId, state: "published", employeeId });
    });

    const state = snapshot.load();
    expect(state.files[0]?.pinned).toBe(true);
    expect(state.approvals[0]?.kind).toBe("social_publish");
    expect(state.approvals[0]?.state).toBe(APPROVAL_STATE.APPROVED);
    expect(state.scheduledPosts[0]?.state).toBe("published");
    expect(state.scheduledPosts[0]?.socialAccountId).toBe(socialAccountId);
    expect(state.scheduledPosts[0]?.approvalId).toBe(state.approvals[0]?.id);
    expect(state.socialAuditRecords.map((record) => record.eventType).sort()).toEqual([
      "account_created",
      "draft_created",
      "state_published",
      "state_scheduled",
    ]);
    expect(state.socialAuditRecords.find((record) => record.eventType === "state_scheduled")).toMatchObject({
      sourceId: postId,
      policyDecision: "approval_requested",
    });
    expect(state.socialAuditRecords.find((record) => record.eventType === "state_published")).toMatchObject({
      sourceId: postId,
      policyDecision: "allowed_after_approval",
    });
    connection.close();
  });

  test("keeps social audit records immutable", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const social = new SocialService(connection.db);
    let auditId = "";

    connection.transaction(() => {
      const orgId = createOrganization(organization);
      const employeeId = firstEmployeeId(connection, orgId);
      social.createAccount({
        orgId,
        platform: SOCIAL_PLATFORM.X,
        handle: "@acme",
        displayName: "Acme",
        createdByEmployeeId: employeeId,
        authorizedEmployeeId: employeeId,
      });
      auditId = (connection.db.prepare("select id from social_audit_records limit 1").get() as { id: string }).id;
    });

    expect(() => connection.db.prepare("update social_audit_records set policy_decision = ? where id = ?")
      .run("changed", auditId)).toThrow("Social audit records are immutable.");
    expect(() => connection.db.prepare("delete from social_audit_records where id = ?")
      .run(auditId)).toThrow("Social audit records are immutable.");
    connection.close();
  });

  test("assigns social publish approvals to the account authorizer", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const social = new SocialService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let authorizerId = "";
    let approvalId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      const creatorId = firstEmployeeId(connection, orgId);
      authorizerId = createEmployee(connection, orgId, "Riley Chen");
      const socialAccountId = social.createAccount({
        orgId,
        platform: SOCIAL_PLATFORM.INSTAGRAM,
        handle: "acme",
        displayName: "Acme",
        createdByEmployeeId: creatorId,
        authorizedEmployeeId: authorizerId,
      });
      const postId = social.createScheduledPost({
        orgId,
        socialAccountId,
        bodyMd: "Launch update.",
        scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        createdByEmployeeId: authorizerId,
      });
      social.setScheduledPostState({ orgId, scheduledPostId: postId, state: "scheduled", employeeId: authorizerId });
      approvalId = (connection.db.prepare("select approval_id from scheduled_posts where id = ?")
        .get(postId) as { approval_id: string }).approval_id;
    });

    const state = snapshot.load();
    expect(state.approvalAssignments).toContainEqual(expect.objectContaining({
      approvalId,
      assigneeType: ROUTE_TO_TYPE.EMPLOYEE,
      assigneeId: authorizerId,
      routingRuleId: null,
    }));
    connection.close();
  });

  test("rejects social actions without account grants", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const social = new SocialService(connection.db);
    let orgId = "";
    let authorizedEmployeeId = "";
    let outsiderId = "";
    let socialAccountId = "";
    let postId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      authorizedEmployeeId = firstEmployeeId(connection, orgId);
      outsiderId = createEmployee(connection, orgId, "Riley Chen");
      socialAccountId = social.createAccount({
        orgId,
        platform: SOCIAL_PLATFORM.LINKEDIN,
        handle: "acme",
        displayName: "Acme",
        createdByEmployeeId: authorizedEmployeeId,
        authorizedEmployeeId,
      });
      postId = social.createScheduledPost({
        orgId,
        socialAccountId,
        bodyMd: "Launch update.",
        scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        createdByEmployeeId: authorizedEmployeeId,
      });
    });

    expect(() => connection.transaction(() => social.createScheduledPost({
      orgId,
      socialAccountId,
      bodyMd: "Unauthorized update.",
      scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      createdByEmployeeId: outsiderId,
    }))).toThrow("Social account grant is required.");
    expect(() => connection.transaction(() => social.setScheduledPostState({
      orgId,
      scheduledPostId: postId,
      state: "cancelled",
      employeeId: outsiderId,
    }))).toThrow("Social account grant is required.");
    expect(() => social.launchLoginWindow({ orgId, socialAccountId, employeeId: outsiderId })).toThrow("Social account grant is required.");
    connection.close();
  });

  test("rejects publish governance when grant risk ceiling is too low", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const social = new SocialService(connection.db);
    let orgId = "";
    let employeeId = "";
    let socialAccountId = "";
    let postId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      employeeId = firstEmployeeId(connection, orgId);
      socialAccountId = social.createAccount({
        orgId,
        platform: SOCIAL_PLATFORM.YOUTUBE,
        handle: "acme",
        displayName: "Acme",
        createdByEmployeeId: employeeId,
        authorizedEmployeeId: employeeId,
      });
      connection.db.prepare("update social_account_grants set scope_json = ? where social_account_id = ?")
        .run(JSON.stringify({ actions: ["login", "draft", "approve"], riskCeiling: "low" }), socialAccountId);
      postId = social.createScheduledPost({
        orgId,
        socialAccountId,
        bodyMd: "Launch update.",
        scheduledFor: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        createdByEmployeeId: employeeId,
      });
    });

    expect(() => connection.transaction(() => social.setScheduledPostState({
      orgId,
      scheduledPostId: postId,
      state: "scheduled",
      employeeId,
    }))).toThrow("Social account grant risk ceiling is insufficient.");
    connection.close();
  });

  test("rejects approval decisions from employees outside the approval organization", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const approvals = new ApprovalService(connection.db);
    let firstOrgId = "";
    let secondOrgId = "";
    let approvalId = "";
    let secondEmployeeId = "";

    connection.transaction(() => {
      firstOrgId = createOrganization(organization);
      secondOrgId = organization.createOrganization({ organizationName: "Beta Ops", employeeName: "Riley Chen", mission: "B", goal: "B" });
      secondEmployeeId = firstEmployeeId(connection, secondOrgId);
      approvalId = approvals.create({
        orgId: firstOrgId,
        kind: "social_publish",
        title: "Approve social post",
        details: "Pilot starts Friday.",
        risk: "medium",
        requestedByType: "employee",
        requestedById: firstEmployeeId(connection, firstOrgId),
      });
    });

    expect(() => connection.transaction(() => approvals.decide({
      orgId: firstOrgId,
      approvalId,
      state: APPROVAL_STATE.APPROVED,
      decidedByEmployeeId: secondEmployeeId,
    }))).toThrow("Deciding employee was not found.");
    connection.close();
  });
});
