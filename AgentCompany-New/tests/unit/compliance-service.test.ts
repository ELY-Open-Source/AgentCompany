import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ChatService } from "../../src/main/services/chat-service";
import { ComplianceService } from "../../src/main/services/compliance-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-compliance-${randomUUID()}.db`));
}

describe("compliance service", () => {
  test("creates GDPR export payloads with audit coverage", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const compliance = new ComplianceService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";
    let spaceId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      spaceId = chat.createSpace({ orgId, spaceType: "project", name: "release", topic: "Release coordination", visibility: "workspace" });
      chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "Exportable message",
        attachmentFileIds: [],
      });
      compliance.createExport({
        orgId,
        subjectType: "employee",
        subjectId: employeeId,
        exportType: "gdpr_export",
        requestedByEmployeeId: employeeId,
      });
    });

    const state = snapshot.load();
    const record = state.complianceExports[0];
    if (!record) throw new Error("Compliance export was not created.");
    const payload = JSON.parse(record.payloadJson) as { profile: { display_name: string }; chatMessages: unknown[] };
    expect(record).toMatchObject({ subjectType: "employee", subjectId: employeeId, exportType: "gdpr_export", state: "completed" });
    expect(payload.profile.display_name).toBe("Dana Lee");
    expect(payload.chatMessages).toHaveLength(1);
    expect(state.auditEvents.some((event) => event.entityType === "compliance_export" && event.action === "created")).toBe(true);
    connection.close();
  });

  test("blocks GDPR delete under holds and redacts after release", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const compliance = new ComplianceService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";
    let spaceId = "";
    let holdId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      spaceId = chat.createSpace({ orgId, spaceType: "project", name: "release", topic: "Release coordination", visibility: "workspace" });
      chat.sendMessage({ orgId, spaceId, threadId: null, senderType: "employee", senderId: employeeId, bodyMd: "Delete me", attachmentFileIds: [] });
      holdId = compliance.createLegalHold({
        orgId,
        entityType: "employee",
        entityId: employeeId,
        reason: "Discovery hold",
        createdByEmployeeId: employeeId,
      });
    });

    expect(() => connection.transaction(() => compliance.createExport({
      orgId,
      subjectType: "employee",
      subjectId: employeeId,
      exportType: "gdpr_delete",
      requestedByEmployeeId: employeeId,
    }))).toThrow("Active compliance hold prevents GDPR delete.");

    connection.transaction(() => {
      compliance.setLegalHoldState({ orgId, legalHoldId: holdId, active: false, employeeId });
      compliance.createExport({
        orgId,
        subjectType: "employee",
        subjectId: employeeId,
        exportType: "gdpr_delete",
        requestedByEmployeeId: employeeId,
      });
    });

    const state = snapshot.load();
    expect(state.employees[0]?.displayName).toBe("Deleted employee");
    expect(state.chatMessages[0]?.senderId).toBeNull();
    expect(state.complianceExports[0]?.exportType).toBe("gdpr_delete");
    expect(state.auditEvents.some((event) => event.entityType === "compliance_export" && event.action === "gdpr_deleted")).toBe(true);
    connection.close();
  });

  test("blocks GDPR delete under organization retention freeze", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const compliance = new ComplianceService(connection.db);
    let orgId = "";
    let employeeId = "";
    let agentId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      agentId = organization.createAgent({
        orgId,
        name: "Ada",
        role: "Release reviewer",
        department: "Engineering",
        modelProviderId: null,
        modelId: null,
        budgetCents: 10000,
        managerAgentId: null,
      });
      compliance.createRetentionFreeze({
        orgId,
        scopeType: "organization",
        scopeId: orgId,
        reason: "Retention freeze",
        createdByEmployeeId: employeeId,
      });
    });

    expect(() => connection.transaction(() => compliance.createExport({
      orgId,
      subjectType: "agent",
      subjectId: agentId,
      exportType: "gdpr_delete",
      requestedByEmployeeId: employeeId,
    }))).toThrow("Active compliance hold prevents GDPR delete.");
    connection.close();
  });

  test("blocks GDPR delete under related chat and file holds", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const compliance = new ComplianceService(connection.db);
    let orgId = "";
    let employeeId = "";
    let spaceId = "";
    let threadId = "";
    let fileId = "";
    let holdId = "";
    let freezeId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      spaceId = chat.createSpace({ orgId, spaceType: "project", name: "release", topic: "Release coordination", visibility: "workspace" });
      chat.sendMessage({ orgId, spaceId, threadId: null, senderType: "employee", senderId: employeeId, bodyMd: "Held chat", attachmentFileIds: [] });
      threadId = (connection.db.prepare("select thread_id from chat_messages where org_id = ?").get(orgId) as { thread_id: string }).thread_id;
      fileId = "file-held";
      connection.db.prepare(`
        insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, owner_type, owner_id, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, orgId, "held.txt", "text/plain", 4, "a".repeat(64), "artifacts/held.txt", "employee", employeeId, new Date().toISOString());
      holdId = compliance.createLegalHold({
        orgId,
        entityType: "chat_thread",
        entityId: threadId,
        reason: "Thread discovery",
        createdByEmployeeId: employeeId,
      });
    });

    expect(() => connection.transaction(() => compliance.createExport({
      orgId,
      subjectType: "employee",
      subjectId: employeeId,
      exportType: "gdpr_delete",
      requestedByEmployeeId: employeeId,
    }))).toThrow("Active compliance hold prevents GDPR delete.");

    connection.transaction(() => {
      compliance.setLegalHoldState({ orgId, legalHoldId: holdId, active: false, employeeId });
      freezeId = compliance.createRetentionFreeze({
        orgId,
        scopeType: "chat_space",
        scopeId: spaceId,
        reason: "Space retention",
        createdByEmployeeId: employeeId,
      });
    });
    expect(() => connection.transaction(() => compliance.createExport({
      orgId,
      subjectType: "employee",
      subjectId: employeeId,
      exportType: "gdpr_delete",
      requestedByEmployeeId: employeeId,
    }))).toThrow("Active compliance hold prevents GDPR delete.");

    connection.transaction(() => {
      compliance.setRetentionFreezeState({ orgId, retentionFreezeId: freezeId, active: false, employeeId });
      compliance.createLegalHold({
        orgId,
        entityType: "file_object",
        entityId: fileId,
        reason: "File discovery",
        createdByEmployeeId: employeeId,
      });
    });
    expect(() => connection.transaction(() => compliance.createExport({
      orgId,
      subjectType: "employee",
      subjectId: employeeId,
      exportType: "gdpr_delete",
      requestedByEmployeeId: employeeId,
    }))).toThrow("Active compliance hold prevents GDPR delete.");
    connection.close();
  });
});
