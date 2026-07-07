import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { canonicalMentionHandle } from "../../src/shared/mention-handles";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

describe("mention resolution", () => {
  test("canonicalMentionHandle strips spaces and lowercases", () => {
    expect(canonicalMentionHandle("Sarah Chen")).toBe("sarahchen");
    expect(canonicalMentionHandle("J.P. Morgan")).toBe("jpmorgan");
    expect(canonicalMentionHandle("alice")).toBe("alice");
  });

  test("@mention with canonical handle resolves to multi-word agent name", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-mention-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let providerId = "";
    let engineerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "TestCorp", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = organization.createAgent({
        orgId, name: "Alex Kim", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
      });
      engineerId = organization.createAgent({
        orgId, name: "Sarah Chen", role: "Engineer", department: "Engineering",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 10000, managerAgentId: ceoId,
      });
    });

    const handle = canonicalMentionHandle("Sarah Chen");
    expect(handle).toBe("sarahchen");

    const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
    const ctx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: providerId, modelId: "gpt-5.4" },
      taskProjectId: null, taskGoalId: null, workspace: null,
    };

    const result = dispatchAgentTool(deps, ctx, call("send_message", {
      channel: "engineering",
      body: `@${handle} can you review this?`,
    }));
    expect(result).toContain("Sarah Chen");

    const mentions = connection.db.prepare(
      "select target_type, target_id, wake_state from chat_mentions where target_type = 'agent' and target_id = ?",
    ).all(engineerId) as Array<{ target_type: string; target_id: string; wake_state: string }>;
    expect(mentions.length).toBeGreaterThan(0);
    expect(mentions[0].target_id).toBe(engineerId);
  });

  test("read_messages returns recent channel messages", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-read-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "ReadCorp", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
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

    dispatchAgentTool(deps, ctx, call("send_message", { channel: "general", body: "Hello team!" }));
    dispatchAgentTool(deps, ctx, call("send_message", { channel: "general", body: "Kickoff meeting at 3pm." }));

    const readResult = dispatchAgentTool(deps, ctx, call("read_messages", { channel: "general" }));
    expect(readResult).toContain("Hello team!");
    expect(readResult).toContain("Kickoff meeting at 3pm.");
  });

  test("read_messages with no channel returns agent mentions", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-inbox-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let engineerId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "InboxCorp", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
      });
      engineerId = organization.createAgent({
        orgId, name: "Dana", role: "Engineer", department: "Engineering",
        modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: ceoId,
      });
    });

    const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
    const ceoCtx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, workspace: null,
    };

    dispatchAgentTool(deps, ceoCtx, call("send_message", { channel: "engineering", body: "@dana check the deployment" }));

    const danaCtx: AgentToolContext = {
      orgId, agent: { id: engineerId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, workspace: null,
    };
    const inbox = dispatchAgentTool(deps, danaCtx, call("read_messages", {}));
    expect(inbox).toContain("check the deployment");
  });
});
