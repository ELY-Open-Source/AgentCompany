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

interface Harness {
  connection: DatabaseConnection;
  organization: OrganizationService;
  chat: ChatService;
  orgId: string;
  employeeId: string;
  ceoId: string;
  danaId: string;
  ctx: AgentToolContext;
}

function harness(options: { enableProvider: boolean }): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-dm-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let ceoId = "";
  let danaId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    if (options.enableProvider) {
      connection.db.prepare("update providers set enabled = 1 where id = ? and org_id = ?").run(providerId, orgId);
    }
    ceoId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
    });
    danaId = organization.createAgent({
      orgId, name: "Dana", role: "Engineer", department: "Engineering",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: ceoId,
    });
  });
  const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
  const chat = new ChatService(connection.db);
  return {
    connection,
    organization,
    chat,
    orgId,
    employeeId,
    ceoId,
    danaId,
    ctx: {
      orgId,
      agent: { id: ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null,
      taskGoalId: null, taskId: null, sourceThreadId: null,
      workspace: null,
    },
  };
}

function directSpaces(h: Harness): Array<{ id: string }> {
  return h.connection.db.prepare("select id from chat_spaces where org_id = ? and space_type = 'direct'")
    .all(h.orgId) as Array<{ id: string }>;
}

describe("agent direct messages", () => {
  test("a DM gets its own conversation and later messages reuse it", () => {
    const h = harness({ enableProvider: false });
    const deps = { db: h.connection.db, organization: h.organization, chat: h.chat };

    const first = dispatchAgentTool(deps, h.ctx, call("send_message", { to: "Dana", body: "How is the booking API going?" }));
    expect(first).toContain("direct message to Dana");
    const threadId = /thread_id="([^"]+)"/.exec(first)?.[1];
    expect(threadId).toBeTruthy();

    dispatchAgentTool(deps, h.ctx, call("send_message", { to: "Dana", body: "Also, ping me when the spec lands.", thread_id: threadId }));

    const spaces = directSpaces(h);
    expect(spaces).toHaveLength(1);
    const members = h.connection.db.prepare("select principal_type, principal_id from chat_memberships where space_id = ?")
      .all(spaces[0].id) as Array<{ principal_type: string; principal_id: string }>;
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.principal_id).sort()).toEqual([h.ceoId, h.danaId].sort());

    const messages = h.connection.db.prepare("select space_id from chat_messages where org_id = ?").all(h.orgId) as Array<{ space_id: string }>;
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.space_id === spaces[0].id)).toBe(true);
  });

  test("a direct message wakes the counterpart agent without an @mention", () => {
    const h = harness({ enableProvider: true });
    const deps = { db: h.connection.db, organization: h.organization, chat: h.chat };

    dispatchAgentTool(deps, h.ctx, call("send_message", { to: "Dana", body: "Take a look at the failing deploy when you can." }));

    const runs = h.connection.db.prepare(
      "select count(*) as count from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention'",
    ).get(h.orgId, h.danaId) as { count: number };
    expect(runs.count).toBe(1);
  });

  test("an employee DM wakes the agent like any messenger would", () => {
    const h = harness({ enableProvider: true });
    const spaceId = h.chat.ensureDirectSpace(h.orgId, { type: "employee", id: h.employeeId }, { type: "agent", id: h.danaId });
    h.chat.sendMessage({
      orgId: h.orgId,
      spaceId,
      threadId: null,
      senderType: "employee",
      senderId: h.employeeId,
      bodyMd: "Dana, what is the launch status?",
      attachmentFileIds: [],
    });
    const runs = h.connection.db.prepare(
      "select count(*) as count from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention'",
    ).get(h.orgId, h.danaId) as { count: number };
    expect(runs.count).toBe(1);
  });

  test("task assignments go to the manager's direct conversation with the assignee", () => {
    const h = harness({ enableProvider: true });
    const deps = { db: h.connection.db, organization: h.organization, chat: h.chat };

    const result = dispatchAgentTool(deps, h.ctx, call("create_task", {
      title: "Ship booking API",
      description: "Design and ship the booking API v1.",
      assignee_agent_name: "Dana",
    }));
    expect(result).toContain("assigned to Dana");

    const spaces = directSpaces(h);
    expect(spaces).toHaveLength(1);
    const assignment = h.connection.db.prepare("select space_id, body_md from chat_messages where org_id = ?").get(h.orgId) as { space_id: string; body_md: string };
    expect(assignment.space_id).toBe(spaces[0].id);
    expect(assignment.body_md).toContain("take task_id=");

    h.organization.updateUiPreferences({ language: "zh" });
    dispatchAgentTool(deps, h.ctx, call("create_task", { title: "Ship docs", description: "d", assignee_agent_name: "Dana" }));
    const zh = h.connection.db.prepare("select body_md from chat_messages where org_id = ? and body_md like '%Ship docs%'").get(h.orgId) as { body_md: string };
    expect(zh.body_md).toContain("请接手 task_id=");
  });

  test("send_message requires exactly one destination", () => {
    const h = harness({ enableProvider: false });
    const deps = { db: h.connection.db, organization: h.organization, chat: h.chat };
    expect(dispatchAgentTool(deps, h.ctx, call("send_message", { body: "hello" }))).toContain("ERROR");
    expect(dispatchAgentTool(deps, h.ctx, call("send_message", { to: "Dana", channel: "general", body: "hello" }))).toContain("ERROR");
  });

  test("read_messages can read a direct conversation by teammate name", () => {
    const h = harness({ enableProvider: false });
    const deps = { db: h.connection.db, organization: h.organization, chat: h.chat };
    dispatchAgentTool(deps, h.ctx, call("send_message", { to: "Dana", body: "Morning - priorities for today are in the doc." }));
    const readBack = dispatchAgentTool(deps, h.ctx, call("read_messages", { with: "Dana" }));
    expect(readBack).toContain("priorities for today");
    expect(readBack).toMatch(/\] CEO \(agent, [^)]+\) \(thread=/);
  });

  test("read_messages reads only where the agent may: restricted channels and others' direct messages need membership", () => {
    const h = harness({ enableProvider: false });
    const deps = { db: h.connection.db, organization: h.organization, chat: h.chat };
    const dana = { ...h.ctx, agent: { id: h.danaId, modelProviderId: null, modelId: null } };
    h.connection.transaction(() => h.chat.createSpace({ orgId: h.orgId, spaceType: "project", name: "board-room", topic: "t", visibility: "restricted", memberAgentIds: [h.ceoId] }));
    dispatchAgentTool(deps, h.ctx, call("send_message", { channel: "board-room", body: "Acquisition terms are 4x revenue." }));
    expect(dispatchAgentTool(deps, h.ctx, call("read_messages", { channel: "board-room" }))).toContain("Acquisition terms");
    expect(dispatchAgentTool(deps, dana, call("read_messages", { channel: "board-room" }))).toBe("ERROR: You are not a member of #board-room, so you cannot read it.");

    const eveId = h.connection.transaction(() => h.organization.createAgent({
      orgId: h.orgId, name: "Eve", role: "Engineer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: h.ceoId,
    }));
    const sent = dispatchAgentTool(deps, h.ctx, call("send_message", { to: "Dana", body: "Your raise is approved." }));
    const threadId = /thread_id="([^"]+)"/.exec(sent)![1];
    expect(dispatchAgentTool(deps, dana, call("read_messages", { thread_id: threadId }))).toContain("Your raise is approved.");
    const eve = { ...h.ctx, agent: { id: eveId, modelProviderId: null, modelId: null } };
    expect(dispatchAgentTool(deps, eve, call("read_messages", { thread_id: threadId }))).toBe(`ERROR: You are not a member of the conversation thread ${threadId} belongs to, so you cannot read it.`);
  });
});
