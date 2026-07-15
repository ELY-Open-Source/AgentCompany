import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool } from "../../src/main/services/agent-tools";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";

interface Harness {
  connection: DatabaseConnection;
  organization: OrganizationService;
  chat: ChatService;
  orgId: string;
  employeeId: string;
  ceoId: string;
  danaId: string;
}

function harness(): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-claim-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let ceoId = "";
  let danaId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    connection.db.prepare("update providers set enabled = 1 where id = ? and org_id = ?").run(providerId, orgId);
    ceoId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
    });
    danaId = organization.createAgent({
      orgId, name: "Dana", role: "Engineer", department: "Engineering",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: ceoId,
    });
  });
  const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
  return { connection, organization, chat: new ChatService(connection.db), orgId, employeeId, ceoId, danaId };
}

describe("queue claim priority", () => {
  test("a human-triggered wake claims before older autonomous work", () => {
    const h = harness();
    const deps = { db: h.connection.db, organization: h.organization, chat: h.chat };

    // T0: agent-triggered wake (CEO DMs Dana) — autonomous conversation.
    dispatchAgentTool(deps, {
      orgId: h.orgId,
      agent: { id: h.ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, workspace: null,
    }, { id: `call_${randomUUID()}`, name: "send_message", arguments: { to: "Dana", body: "Status?" } });
    const danaRun = h.connection.db.prepare(
      "select id from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention'",
    ).get(h.orgId, h.danaId) as { id: string };
    // Make it decisively older than what follows.
    h.connection.db.prepare("update task_runs set created_at = ? where id = ?")
      .run(new Date(Date.now() - 60_000).toISOString(), danaRun.id);

    // T1: the founder DMs the CEO — a human is waiting at the keyboard.
    const spaceId = h.chat.ensureDirectSpace(h.orgId, { type: "employee", id: h.employeeId }, { type: "agent", id: h.ceoId });
    h.chat.sendMessage({
      orgId: h.orgId, spaceId, threadId: null, senderType: "employee", senderId: h.employeeId,
      bodyMd: "How is the project going?", attachmentFileIds: [],
    });
    const ceoRun = h.connection.db.prepare(
      "select id from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention'",
    ).get(h.orgId, h.ceoId) as { id: string };

    // The founder's newer wake outranks the older autonomous one.
    expect(claimNextQueuedRun(h.connection)?.id).toBe(ceoRun.id);
    expect(claimNextQueuedRun(h.connection)?.id).toBe(danaRun.id);
    expect(claimNextQueuedRun(h.connection)).toBeNull();
    h.connection.close();
  });

  test("among human-triggered wakes, order stays first come first served", () => {
    const h = harness();
    const wakeByFounder = (agentId: string): string => {
      const spaceId = h.chat.ensureDirectSpace(h.orgId, { type: "employee", id: h.employeeId }, { type: "agent", id: agentId });
      h.chat.sendMessage({
        orgId: h.orgId, spaceId, threadId: null, senderType: "employee", senderId: h.employeeId,
        bodyMd: "ping", attachmentFileIds: [],
      });
      return (h.connection.db.prepare(
        "select id from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention'",
      ).get(h.orgId, agentId) as { id: string }).id;
    };
    const first = wakeByFounder(h.danaId);
    h.connection.db.prepare("update task_runs set created_at = ? where id = ?")
      .run(new Date(Date.now() - 30_000).toISOString(), first);
    const second = wakeByFounder(h.ceoId);

    expect(claimNextQueuedRun(h.connection)?.id).toBe(first);
    expect(claimNextQueuedRun(h.connection)?.id).toBe(second);
    h.connection.close();
  });
});
