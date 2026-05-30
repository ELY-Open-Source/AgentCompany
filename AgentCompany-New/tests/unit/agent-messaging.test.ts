import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

describe("agent messaging", () => {
  test("agents post to a department channel and reply in the same thread", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-msg-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
      const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
      });
    });
    const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
    const ctx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, workspace: null,
    };

    const first = dispatchAgentTool(deps, ctx, call("send_message", { channel: "engineering", body: "Assigning the booking API to Dana." }));
    const threadId = /thread_id=([^),\s]+)/.exec(first)?.[1];
    expect(threadId).toBeTruthy();
    const second = dispatchAgentTool(deps, ctx, call("send_message", { channel: "engineering", body: "Update: API shipped.", thread_id: threadId }));
    expect(second).toContain("Posted to #engineering");

    const engineering = connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'engineering'").get(orgId) as { id: string };
    const messages = connection.db.prepare("select space_id, thread_id, sender_type, sender_id from chat_messages where org_id = ?")
      .all(orgId) as Array<{ space_id: string; thread_id: string; sender_type: string; sender_id: string }>;
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.space_id === engineering.id)).toBe(true);
    expect(messages.every((m) => m.sender_type === "agent" && m.sender_id === ceoId)).toBe(true);
    // Both messages share the one thread — the reply joined the assignment thread.
    expect(new Set(messages.map((m) => m.thread_id)).size).toBe(1);
    connection.close();
  });
});
