import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ApprovalService } from "../../src/main/services/approval-service";
import { ChatService } from "../../src/main/services/chat-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { RISK_LEVEL } from "../../src/shared/domain";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-chat-${randomUUID()}.db`));
}

describe("chat governance", () => {
  test("persists memberships, retention policy, and structured delivery metadata", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const snapshot = new SnapshotService(connection.db);
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
        role: "Release reviewer",
        department: "Engineering",
        modelProviderId: null,
        modelId: null,
        budgetCents: 10000,
        managerAgentId: null,
      });
      spaceId = chat.createSpace({
        orgId,
        spaceType: "project",
        name: "release-review",
        topic: "Release review",
        visibility: "restricted",
        memberEmployeeIds: [employeeId],
        memberAgentIds: [agentId],
      });
      chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "/escalate review @Ada-Lovelace release gate",
        attachmentFileIds: [],
      });
    });

    const state = snapshot.load();
    const message = state.chatMessages[0];
    const structure = JSON.parse(message!.bodyStructuredJson) as {
      slashInvocation: { command: string };
      mentions: Array<{ targetType: string; targetId: string }>;
    };
    expect(state.chatSpaces.find((space) => space.id === spaceId)?.retentionPolicy).toBe("restricted_365d");
    expect(state.chatMemberships
      .filter((membership) => membership.spaceId === spaceId)
      .map((membership) => `${membership.principalType}:${membership.principalId}`)
      .sort())
      .toEqual([`agent:${agentId}`, `employee:${employeeId}`]);
    expect(message).toMatchObject({ deliveryState: "sent" });
    expect(structure.slashInvocation.command).toBe("escalate");
    expect(structure.mentions[0]).toMatchObject({ targetType: "agent", targetId: agentId });
    connection.close();
  });

  test("audits chat message edits and deletes", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";
    let agentId = "";
    let spaceId = "";
    let messageId = "";

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
      messageId = chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "Initial launch note @Ada-Lovelace",
        attachmentFileIds: [],
      });
      chat.editMessage({
        orgId,
        messageId,
        actorType: "employee",
        actorId: employeeId,
        bodyMd: `Updated launch note @${agentId}`,
      });
      chat.deleteMessage({ orgId, messageId, actorType: "employee", actorId: employeeId });
    });

    const state = snapshot.load();
    const message = state.chatMessages.find((item) => item.id === messageId);
    expect(message).toMatchObject({ bodyMd: `Updated launch note @${agentId}` });
    expect(message?.editedAt).toBeTruthy();
    expect(message?.deletedAt).toBeTruthy();
    expect(state.chatMentions).toEqual([expect.objectContaining({ messageId, targetType: "agent", targetId: agentId })]);
    expect(state.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "chat_message", entityId: messageId, action: "edited" }),
      expect.objectContaining({ entityType: "chat_message", entityId: messageId, action: "deleted" }),
    ]));
    connection.close();
  });

  test("decides approvals from chat slash commands", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const approvals = new ApprovalService(connection.db);
    const chat = new ChatService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";
    let spaceId = "";
    let approvalId = "";
    let declinedApprovalId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      spaceId = chat.createSpace({ orgId, spaceType: "project", name: "release", topic: "Release coordination", visibility: "workspace" });
      approvalId = approvals.create({
        orgId,
        kind: "release_gate",
        title: "Release gate",
        details: "Review the release window.",
        risk: RISK_LEVEL.HIGH,
        requestedByType: "employee",
        requestedById: employeeId,
      });
      declinedApprovalId = approvals.create({
        orgId,
        kind: "release_gate",
        title: "Rollback gate",
        details: "Review rollback window.",
        risk: RISK_LEVEL.HIGH,
        requestedByType: "employee",
        requestedById: employeeId,
      });
      chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: `/approve ${approvalId} release window cleared`,
        attachmentFileIds: [],
      });
      chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: `/deny ${declinedApprovalId} rollback window blocked`,
        attachmentFileIds: [],
      });
    });

    const state = snapshot.load();
    expect(state.approvals.find((item) => item.id === approvalId)?.state).toBe("approved");
    expect(state.approvals.find((item) => item.id === declinedApprovalId)?.state).toBe("declined");
    expect(state.chatSlashInvocations).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "approve", resultRef: approvalId }),
      expect.objectContaining({ command: "deny", resultRef: declinedApprovalId }),
    ]));
    expect(state.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "approval", entityId: approvalId, action: "approved" }),
      expect.objectContaining({ entityType: "approval", entityId: declinedApprovalId, action: "declined" }),
    ]));
    connection.close();
  });

  test("routes collaboration slash commands to concrete domain targets", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";
    let agentId = "";
    let spaceId = "";
    let skillId = "";
    let fileId = "";
    let agentMessageId = "";
    let skillMessageId = "";
    let fileMessageId = "";
    let runbookMessageId = "";
    let handoffMessageId = "";

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
      skillId = "skd_release_gate";
      fileId = "fil_release_notes";
      const now = new Date().toISOString();
      connection.db.prepare(`
        insert into skill_definitions(id, org_id, slug, name, owner_type, status, created_at)
        values (?, ?, ?, ?, ?, ?, ?)
      `).run(skillId, orgId, "release-gate", "Release Gate", "system", "active", now);
      connection.db.prepare(`
        insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, owner_type, owner_id, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, orgId, "release-notes.md", "md", 24, "8f3a", "artifacts/release-notes.md", "employee", employeeId, now);
      agentMessageId = chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "/agent @Ada review the gate",
        attachmentFileIds: [],
      });
      skillMessageId = chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "/skill release-gate apply release checks",
        attachmentFileIds: [],
      });
      fileMessageId = chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "/file release-notes.md",
        attachmentFileIds: [],
      });
      runbookMessageId = chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "/runbook release rollback steps",
        attachmentFileIds: [],
      });
      handoffMessageId = chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "/handoff @Ada release notes",
        attachmentFileIds: [fileId],
      });
    });

    const state = snapshot.load();
    const slashByMessage = new Map(state.chatSlashInvocations.map((item) => [item.messageId, item]));
    expect(slashByMessage.get(agentMessageId)).toMatchObject({ command: "agent", resultRef: agentId });
    expect(slashByMessage.get(skillMessageId)).toMatchObject({ command: "skill", resultRef: skillId });
    expect(slashByMessage.get(fileMessageId)).toMatchObject({ command: "file", resultRef: fileId });
    expect(slashByMessage.get(runbookMessageId)).toMatchObject({ command: "runbook", resultRef: runbookMessageId });
    expect(slashByMessage.get(handoffMessageId)).toMatchObject({ command: "handoff", resultRef: fileId });
    expect(state.chatPresence).toContainEqual(expect.objectContaining({ principalType: "agent", principalId: agentId, status: "thinking" }));
    expect(state.fileHandoffRecords).toContainEqual(expect.objectContaining({
      messageId: handoffMessageId,
      fileId,
      targetPrincipalType: "agent",
      targetPrincipalId: agentId,
      policyDecision: "approved_for_handoff",
    }));
    expect(state.auditEvents.filter((event) => event.action === "slash_routed")).toHaveLength(5);
    connection.close();
  });

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
      bodyMd: "/approve",
      attachmentFileIds: [],
    }))).toThrow("Slash command /approve requires an approval id.");
    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId: workspaceSpaceId,
      threadId: null,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "/agent wake release checks",
      attachmentFileIds: [],
    }))).toThrow("Slash command /agent requires an agent mention.");
    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId: workspaceSpaceId,
      threadId: null,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "/handoff @Ada release notes",
      attachmentFileIds: [],
    }))).toThrow("Slash command /handoff requires a file attachment.");
    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId: workspaceSpaceId,
      threadId: null,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "/file missing.md",
      attachmentFileIds: [],
    }))).toThrow("Slash command /file target was not found.");
    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId: workspaceSpaceId,
      threadId: null,
      senderType: "employee",
      senderId: employeeId,
      bodyMd: "/skill missing-skill",
      attachmentFileIds: [],
    }))).toThrow("Slash command /skill target was not found.");
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
