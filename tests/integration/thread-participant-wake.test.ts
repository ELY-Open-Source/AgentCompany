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

describe("thread participant wake", () => {
  test("human reply in a thread wakes agent participants without explicit @mention", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-threadwake-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let employeeId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "WakeCorp", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      connection.db.prepare("update providers set enabled = 1 where id = ?").run(providerId);
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    });

    const chat = new ChatService(connection.db);
    const deps = { db: connection.db, organization, chat };
    const ctx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: providerId, modelId: "gpt-5.4" },
      taskProjectId: null, taskGoalId: null, workspace: null,
    };

    const firstResult = dispatchAgentTool(deps, ctx, call("send_message", { channel: "general", body: "The plan is ready for review." }));
    const threadId = /thread_id="([^"]+)"/.exec(firstResult)?.[1];
    expect(threadId).toBeTruthy();

    const runsBeforeReply = connection.db.prepare("select count(*) as c from task_runs where org_id = ? and trigger = 'chat_mention'")
      .get(orgId) as { c: number };

    connection.transaction(() => {
      chat.sendMessage({
        orgId,
        spaceId: (connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'general'").get(orgId) as { id: string }).id,
        threadId: threadId!,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "Looks good, please proceed with the deployment.",
        attachmentFileIds: [],
      });
    });

    const runsAfterReply = connection.db.prepare("select count(*) as c from task_runs where org_id = ? and trigger = 'chat_mention'")
      .get(orgId) as { c: number };
    expect(runsAfterReply.c).toBeGreaterThan(runsBeforeReply.c);

    // A second human message in the same thread coalesces into the still-queued
    // wake instead of spending another run on the same conversation.
    connection.transaction(() => {
      chat.sendMessage({
        orgId,
        spaceId: (connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'general'").get(orgId) as { id: string }).id,
        threadId: threadId!,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "One more thing: schedule the rollout for Friday.",
        attachmentFileIds: [],
      });
    });
    const runsAfterSecondReply = connection.db.prepare("select count(*) as c from task_runs where org_id = ? and trigger = 'chat_mention'")
      .get(orgId) as { c: number };
    expect(runsAfterSecondReply.c).toBe(runsAfterReply.c);
    const wakeTasks = connection.db.prepare(
      "select count(distinct r.task_id) as c from task_runs r where r.org_id = ? and r.trigger = 'chat_mention'",
    ).get(orgId) as { c: number };
    expect(wakeTasks.c).toBe(1);
  });
});
