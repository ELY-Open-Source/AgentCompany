import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { AuditService } from "../../src/main/services/audit-service";
import { ChatService } from "../../src/main/services/chat-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-audit-${randomUUID()}.db`));
}

describe("audit service", () => {
  test("keeps core audit events immutable", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    let auditId = "";

    connection.transaction(() => {
      const orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      auditId = (connection.db.prepare("select id from audit_events where org_id = ? limit 1").get(orgId) as { id: string }).id;
    });

    expect(() => connection.db.prepare("update audit_events set action = ? where id = ?")
      .run("changed", auditId)).toThrow("Audit events are immutable.");
    expect(() => connection.db.prepare("delete from audit_events where id = ?")
      .run(auditId)).toThrow("Audit events are immutable.");
    connection.close();
  });

  test("creates thread scoped replay runs from immutable audit events", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const audit = new AuditService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";
    let threadId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      const spaceId = chat.createSpace({
        orgId,
        spaceType: "project",
        name: "release",
        topic: "Release coordination",
        visibility: "workspace",
      });
      const messageId = chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "/escalate review release plan",
        attachmentFileIds: [],
      });
      threadId = (connection.db.prepare("select thread_id from chat_messages where id = ?").get(messageId) as { thread_id: string }).thread_id;
      audit.createThreadReplay({ orgId, threadId, createdByEmployeeId: employeeId });
    });

    const state = snapshot.load();
    const run = state.auditReplayRuns[0];
    if (!run) throw new Error("Audit replay run was not created.");
    const replay = JSON.parse(run.replayJson) as { events: Array<{ entityType: string; action: string }> };
    expect(run.threadId).toBe(threadId);
    expect(run.eventDigest).toHaveLength(64);
    expect(run.eventCount).toBe(replay.events.length);
    expect(replay.events).toContainEqual(expect.objectContaining({ entityType: "chat_message", action: "sent" }));
    expect(replay.events).toContainEqual(expect.objectContaining({ entityType: "approval", action: "requested" }));
    expect(replay.events.some((event) => event.entityType === "audit_replay_run")).toBe(false);
    expect(state.auditEvents.some((event) => event.entityType === "audit_replay_run" && event.action === "created")).toBe(true);
    connection.close();
  });
});
