import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ChatService } from "../../src/main/services/chat-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-chat-${randomUUID()}.db`));
}

describe("chat governance", () => {
  test("records board interventions and enforces thread control", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";
    let agentId = "";
    let spaceId = "";
    let threadId = "";

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
      spaceId = chat.createSpace({ orgId, spaceType: "project", name: "release", topic: "Release coordination", visibility: "workspace" });
      chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "Release thread",
        attachmentFileIds: [],
      });
      threadId = (connection.db.prepare("select id from chat_threads where space_id = ?").get(spaceId) as { id: string }).id;
      chat.sendMessage({
        orgId,
        spaceId,
        threadId,
        senderType: "board",
        senderId: employeeId,
        bodyMd: "/board freeze hold the release",
        attachmentFileIds: [],
      });
    });

    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId,
      threadId,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "Proceeding",
      attachmentFileIds: [],
    }))).toThrow("Board-frozen thread requires board sender.");

    connection.transaction(() => {
      chat.sendMessage({
        orgId,
        spaceId,
        threadId,
        senderType: "board",
        senderId: employeeId,
        bodyMd: "/board rollback reopen release coordination",
        attachmentFileIds: [],
      });
      chat.sendMessage({
        orgId,
        spaceId,
        threadId,
        senderType: "board",
        senderId: employeeId,
        bodyMd: `/board takeover @${agentId} Ada owns release checks`,
        attachmentFileIds: [],
      });
    });

    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId,
      threadId,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "Taking back control",
      attachmentFileIds: [],
    }))).toThrow("Board takeover controls this thread.");

    connection.transaction(() => {
      chat.sendMessage({
        orgId,
        spaceId,
        threadId,
        senderType: "agent",
        senderId: agentId,
        bodyMd: "Release checks are in progress.",
        attachmentFileIds: [],
      });
      chat.sendMessage({
        orgId,
        spaceId,
        threadId,
        senderType: "board",
        senderId: employeeId,
        bodyMd: "/board force-approval approve gated release window",
        attachmentFileIds: [],
      });
    });

    const state = snapshot.load();
    const thread = state.chatThreads.find((item) => item.id === threadId);
    expect(thread).toMatchObject({ boardState: "takeover", controlledByType: "agent", controlledById: agentId });
    expect(state.boardInterventions.map((item) => item.action)).toEqual(["freeze", "rollback", "takeover", "force_approval"]);
    const forceApproval = state.approvals.find((item) => item.kind === "board_force_approval");
    if (!forceApproval) throw new Error("Board force approval was not created.");
    const forceIntervention = state.boardInterventions.find((item) => item.action === "force_approval");
    if (!forceIntervention) throw new Error("Board force approval intervention was not created.");
    expect(forceIntervention.approvalId).toBe(forceApproval.id);
    expect(state.chatSlashInvocations.some((item) => item.resultRef === forceIntervention.id)).toBe(true);
    expect(state.auditEvents.some((event) => event.entityType === "board_intervention" && event.action === "recorded")).toBe(true);
    connection.close();
  });

  test("rejects chat writes outside membership and prevents partial invalid messages", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    let orgId = "";
    let employeeId = "";
    let agentId = "";
    let restrictedSpaceId = "";
    let workspaceSpaceId = "";

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
      restrictedSpaceId = chat.createSpace({
        orgId,
        spaceType: "project",
        name: "board-review",
        topic: "Restricted release review",
        visibility: "restricted",
        memberEmployeeIds: [employeeId],
      });
      workspaceSpaceId = chat.createSpace({
        orgId,
        spaceType: "project",
        name: "release",
        topic: "Release coordination",
        visibility: "workspace",
      });
    });

    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId: restrictedSpaceId,
      threadId: null,
      senderType: "agent",
      senderId: agentId,
      bodyMd: "I should not be here.",
      attachmentFileIds: [],
    }))).toThrow("Chat membership is required.");
    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId: restrictedSpaceId,
      threadId: null,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "Restricted ping @Ada",
      attachmentFileIds: [],
    }))).toThrow("Mention @Ada could not be resolved.");
    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId: workspaceSpaceId,
      threadId: null,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "/unknown command",
      attachmentFileIds: [],
    }))).toThrow("Slash command /unknown is unavailable.");
    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId: workspaceSpaceId,
      threadId: null,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "Missing file",
      attachmentFileIds: ["file_missing"],
    }))).toThrow("Attachment file was not found.");
    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId: workspaceSpaceId,
      threadId: null,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "/escalate",
      attachmentFileIds: [],
    }))).toThrow("Slash command /escalate requires details.");
    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId: workspaceSpaceId,
      threadId: null,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "Unknown @Nobody",
      attachmentFileIds: [],
    }))).toThrow("Mention @Nobody could not be resolved.");

    const count = connection.db.prepare("select count(*) as count from chat_messages").get() as { count: number };
    expect(count.count).toBe(0);
    connection.close();
  });

  test("rejects reserved mention handles for employees and agents", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    let orgId = "";

    expect(() => connection.transaction(() => organization.createOrganization({
      organizationName: "Acme Operations",
      employeeName: "Board",
      mission: "Coordinate agents with auditable approvals.",
      goal: "Ship a verified control plane.",
    }))).toThrow("Mention handle is reserved.");

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
    });
    expect(() => connection.transaction(() => organization.createAgent({
      orgId,
      name: "On Call",
      role: "Escalation lead",
      department: "Operations",
      modelProviderId: null,
      modelId: null,
      budgetCents: 10000,
      managerAgentId: null,
    }))).toThrow("Mention handle is reserved.");
    connection.close();
  });

  test("rejects ambiguous chat mentions", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
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
      organization.createAgent({ orgId, name: "Ada", role: "Reviewer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 10000, managerAgentId: null });
      organization.createAgent({ orgId, name: "Ada", role: "Release lead", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 10000, managerAgentId: null });
      spaceId = chat.createSpace({ orgId, spaceType: "project", name: "release", topic: "Release coordination", visibility: "workspace" });
    });

    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId,
      threadId: null,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "Please review @Ada",
      attachmentFileIds: [],
    }))).toThrow("Mention @Ada is ambiguous.");
    const count = connection.db.prepare("select count(*) as count from chat_messages").get() as { count: number };
    expect(count.count).toBe(0);
    connection.close();
  });

  test("resolves chat mentions by display handle and principal id", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    let orgId = "";
    let employeeId = "";
    let agentId = "";
    let spaceId = "";

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
        name: "Ada Lovelace",
        role: "Reviewer",
        department: "Engineering",
        modelProviderId: null,
        modelId: null,
        budgetCents: 10000,
        managerAgentId: null,
      });
      spaceId = chat.createSpace({ orgId, spaceType: "project", name: "release", topic: "Release coordination", visibility: "workspace" });
    });

    connection.transaction(() => {
      chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: `Review @Ada-Lovelace and @${agentId}`,
        attachmentFileIds: [],
      });
    });

    const mentions = connection.db.prepare(`
      select target_type, target_id
      from chat_mentions
      order by offset_start asc
    `).all() as Array<{ target_type: string; target_id: string }>;
    expect(mentions).toEqual([
      { target_type: "agent", target_id: agentId },
      { target_type: "agent", target_id: agentId },
    ]);
    connection.close();
  });

  test("rejects replies to threads from another chat space", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    let orgId = "";
    let employeeId = "";
    let firstSpaceId = "";
    let secondSpaceId = "";
    let threadId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      firstSpaceId = chat.createSpace({ orgId, spaceType: "project", name: "release-a", topic: "A", visibility: "workspace" });
      secondSpaceId = chat.createSpace({ orgId, spaceType: "project", name: "release-b", topic: "B", visibility: "workspace" });
      chat.sendMessage({
        orgId,
        spaceId: firstSpaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "Root",
        attachmentFileIds: [],
      });
      threadId = (connection.db.prepare("select id from chat_threads where space_id = ?").get(firstSpaceId) as { id: string }).id;
    });

    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId: secondSpaceId,
      threadId,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "Wrong thread",
      attachmentFileIds: [],
    }))).toThrow("Chat thread was not found in this space.");
    const count = connection.db.prepare("select count(*) as count from chat_messages").get() as { count: number };
    expect(count.count).toBe(1);
    connection.close();
  });
});
