import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { createRunMessagePoller } from "../../src/main/services/chat-wake-context";

describe("the mid-run inbox", () => {
  test("injects each new message once, even after another company's deletion frees message row numbers", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-inbox-${randomUUID()}.db`));
    const db = connection.db;
    const organization = new OrganizationService(db);
    const chat = new ChatService(db);
    const company = (name: string) => {
      const orgId = organization.createOrganization({ organizationName: name, employeeName: "Yang", mission: "m", goal: "g" });
      const agentId = organization.createAgent({ orgId, name: "Dana", role: "Engineer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null });
      const employeeId = (db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      const spaceId = chat.ensureDirectSpace(orgId, { type: "employee", id: employeeId }, { type: "agent", id: agentId });
      const say = (bodyMd: string, threadId: string | null) => {
        const messageId = chat.sendMessage({ orgId, spaceId, threadId, senderType: "employee", senderId: employeeId, bodyMd, attachmentFileIds: [] });
        return (db.prepare("select thread_id from chat_messages where id = ?").get(messageId) as { thread_id: string }).thread_id;
      };
      return { orgId, agentId, say };
    };
    const ours = connection.transaction(() => company("Ours"));
    const threadId = ours.say("Start.", null);
    const theirs = connection.transaction(() => company("Theirs"));
    for (let i = 0; i < 5; i++) theirs.say(`Noise ${i}`, null);
    const injected: string[] = [];
    const poll = createRunMessagePoller(db, { orgId: ours.orgId, agentId: ours.agentId, sourceThreadId: threadId, runStartedAt: new Date(0).toISOString(), onInjected: (entries) => injected.push(...entries.map((entry) => entry.id)) });
    expect(poll()).toBeNull();
    connection.transaction(() => organization.deleteOrganization(theirs.orgId));
    ours.say("Correction.", threadId);
    expect(poll()).toContain("Correction.");
    expect(poll()).toBeNull();
    expect(injected).toHaveLength(1);
    connection.close();
  });
});
