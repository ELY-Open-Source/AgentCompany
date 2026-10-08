import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { DatabaseConnection } from "../../src/main/database/connection";
import { IntegrationKeyStore } from "../../src/main/services/integration-key-store";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { runAgentLoop } from "../../src/main/services/agent-run-loop";
import { canonicalMentionHandle } from "../../src/shared/mention-handles";
import type { AgentToolContext } from "../../src/main/services/agent-tools";
import type { AgentTurnResult, ToolCall } from "../../src/main/services/provider-tool-turn";

interface ScriptedTurn {
  text: string;
  toolCalls: ToolCall[];
}

function fakeProvider(script: ScriptedTurn[], db: DatabaseSync) {
  let index = 0;
  return {
    integrationKeys: new IntegrationKeyStore(db),
    runToolTurn: async (): Promise<AgentTurnResult & { requestId: string }> => {
      const turn = script[index] ?? { text: "done", toolCalls: [] };
      index += 1;
      return { text: turn.text, toolCalls: turn.toolCalls, rawResponseJson: "{}", requestId: `req_${index}` };
    },
  };
}

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

describe("agent run loop (real tool dispatch)", () => {
  test("the CEO hires, creates a task, writes a deliverable, then converges", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-loop-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const workspaceRoot = join(tmpdir(), `ac-ws-${randomUUID()}`);
    mkdirSync(workspaceRoot, { recursive: true });

    let orgId = "";
    let ceoId = "";
    let providerId = "";
    const workspaceId = "wsp_test";
    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "OrbitOps", employeeName: "Yang", mission: "Run an AI company.", goal: "Win customers.",
      });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      connection.db.prepare("update providers set enabled = 1 where id = ?").run(providerId);
      connection.db.prepare(`
        insert into workspaces(id, org_id, name, local_path, repo_url, repo_ref, project_id, is_primary, created_at, updated_at)
        values (?, ?, 'Default Workspace', ?, '', '', null, 1, datetime('now'), datetime('now'))
      `).run(workspaceId, orgId, workspaceRoot);
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", title: "Chief Executive Officer", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
        roleLevel: "c_suite", workspaceId,
      });
    });

    const toolContext: AgentToolContext = {
      orgId,
      agent: { id: ceoId, modelProviderId: providerId, modelId: "gpt-5.4" },
      taskProjectId: null,
      taskGoalId: null, taskId: null, sourceThreadId: null,
      workspace: { id: workspaceId, localPath: workspaceRoot, writeAccess: true },
    };

    const script: ScriptedTurn[] = [
      { text: "Staffing the team.", toolCalls: [
        call("hire_agent", { name: "Alex Rivera", role: "Growth Marketer", department: "Marketing" }),
        call("hire_agent", { name: "Sam Lee", role: "Operations Lead", department: "Operations" }),
      ] },
      { text: "Delegating.", toolCalls: [
        call("create_task", { title: "Build the booking site", description: "Ship a landing + booking flow.", assignee_agent_name: "Alex Rivera" }),
      ] },
      { text: "Writing the plan.", toolCalls: [
        call("write_deliverable", { path: "plan/operating-plan.md", content: "# Operating Plan\n\n1. Validate demand.\n2. Launch booking site.\n" }),
        call("send_message", { channel: "general", body: "Team staffed and the operating plan is live. Booking site is next." }),
      ] },
      { text: "Team staffed, work delegated, plan written.", toolCalls: [] },
    ];

    let toolResultNotifications = 0;
    const result = await runAgentLoop(
      {
        providers: fakeProvider(script, connection.db),
        tools: { db: connection.db, organization, chat: new ChatService(connection.db) },
        onToolResults: () => { toolResultNotifications += 1; },
      },
      { orgId, providerId, inputBudgetTokens: 112_000, workspaceId, instructions: "You are the CEO.", initialUserTurn: "Start the company.", toolContext },
    );

    expect(result.iterations).toBe(4);
    expect(result.toolCallCount).toBe(5);
    expect(result.finalText).toContain("Team staffed");
    // The UI is told about new data after every tool-bearing iteration, not only at the end.
    expect(toolResultNotifications).toBe(3);

    const agentNames = (connection.db.prepare("select name from agents where org_id = ? order by name").all(orgId) as Array<{ name: string }>).map((r) => r.name);
    expect(agentNames).toEqual(["Alex Rivera", "CEO", "Sam Lee"]);

    const task = connection.db.prepare("select title, assignee_agent_id from tasks where org_id = ?").get(orgId) as { title: string; assignee_agent_id: string } | undefined;
    expect(task?.title).toBe("Build the booking site");
    const alexId = (connection.db.prepare("select id from agents where org_id = ? and name = 'Alex Rivera'").get(orgId) as { id: string }).id;
    expect(task?.assignee_agent_id).toBe(alexId);

    const deliverablePath = join(workspaceRoot, "plan", "operating-plan.md");
    expect(existsSync(deliverablePath)).toBe(true);
    expect(readFileSync(deliverablePath, "utf8")).toContain("Operating Plan");

    // The assignment message and the CEO's coordination message both land in chat.
    const messages = connection.db.prepare(
      "select sender_type, sender_id, body_md, space_id from chat_messages where org_id = ?",
    ).all(orgId) as Array<{ sender_type: string; sender_id: string; body_md: string; space_id: string }>;
    expect(messages).toHaveLength(2);
    expect(messages).toContainEqual(expect.objectContaining({ sender_type: "agent", sender_id: ceoId, body_md: expect.stringContaining(`@${canonicalMentionHandle("Alex Rivera")}`) }));
    expect(messages).toContainEqual(expect.objectContaining({ sender_type: "agent", sender_id: ceoId, body_md: expect.stringContaining("operating plan is live") }));

    connection.close();
  });

  test("rejects deliverable paths that escape the workspace", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-loop2-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const workspaceRoot = join(tmpdir(), `ac-ws2-${randomUUID()}`);
    mkdirSync(workspaceRoot, { recursive: true });
    let orgId = "";
    let ceoId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = organization.createAgent({ orgId, name: "CEO", role: "CEO", department: "Executive", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null });
    });
    const ctx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: providerId, modelId: "gpt-5.4" },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: { id: "wsp", localPath: workspaceRoot, writeAccess: true },
    };
    const script: ScriptedTurn[] = [
      { text: "escape", toolCalls: [call("write_deliverable", { path: "../escape.txt", content: "x" })] },
      { text: "done", toolCalls: [] },
    ];
    const result = await runAgentLoop(
      { providers: fakeProvider(script, connection.db), tools: { db: connection.db, organization, chat: new ChatService(connection.db) } },
      { orgId, providerId, inputBudgetTokens: 112_000, workspaceId: null, instructions: "i", initialUserTurn: "u", toolContext: ctx },
    );
    // The tool returns an error string to the model; nothing is written outside the root.
    expect(existsSync(join(workspaceRoot, "..", "escape.txt"))).toBe(false);
    expect(result.toolCallCount).toBe(1);
    connection.close();
  });

  test("delegating a task opens an assignment thread for the assignee", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-loop-assign-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g",
      });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      connection.db.prepare("update providers set enabled = 1 where id = ?").run(providerId);
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
      });
    });
    const ctx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: providerId, modelId: "gpt-5.4" },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    };
    const script: ScriptedTurn[] = [
      { text: "staff", toolCalls: [call("hire_agent", { name: "Alex Rivera", role: "Engineer", department: "Engineering" })] },
      { text: "delegate", toolCalls: [call("create_task", { title: "Build the booking API", description: "Ship the booking API.", assignee_agent_name: "Alex Rivera" })] },
      { text: "done", toolCalls: [] },
    ];

    await runAgentLoop(
      { providers: fakeProvider(script, connection.db), tools: { db: connection.db, organization, chat: new ChatService(connection.db) } },
      { orgId, providerId, inputBudgetTokens: 112_000, workspaceId: null, instructions: "i", initialUserTurn: "u", toolContext: ctx },
    );

    const alex = connection.db.prepare("select id from agents where org_id = ? and name = 'Alex Rivera'").get(orgId) as { id: string };
    const assignment = connection.db.prepare(`
      select m.body_md, m.thread_id, s.id as space_id, s.space_type
      from chat_messages m
      join chat_spaces s on s.id = m.space_id
      where m.org_id = ?
    `).get(orgId) as { body_md: string; thread_id: string; space_id: string; space_type: string } | undefined;
    // Assignments are 1:1 hand-offs, so they live in the manager's direct
    // conversation with the assignee instead of a shared channel.
    expect(assignment).toMatchObject({ space_type: "direct" });
    const dmMembers = connection.db.prepare("select principal_id from chat_memberships where space_id = ?")
      .all(assignment?.space_id ?? "") as Array<{ principal_id: string }>;
    expect(dmMembers.map((m) => m.principal_id).sort()).toEqual([ceoId, alex.id].sort());
    expect(assignment?.body_md).toContain(`@${canonicalMentionHandle("Alex Rivera")}`);
    expect(assignment?.body_md).toContain("Build the booking API");

    const wake = connection.db.prepare(`
      select state, trigger, secret_scope_json
      from task_runs
      where org_id = ? and agent_id = ? and trigger = 'chat_mention'
    `).get(orgId, alex.id) as { state: string; trigger: string; secret_scope_json: string } | undefined;
    expect(wake).toMatchObject({ state: "queued", trigger: "chat_mention" });
    expect(JSON.parse(wake?.secret_scope_json ?? "{}")).toMatchObject({ sourceThreadId: assignment?.thread_id });
    connection.close();
  });

  test("a first turn with no text and no tool calls fails the run instead of completing a no-op", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-loop3-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = organization.createAgent({ orgId, name: "CEO", role: "CEO", department: "Executive", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null });
    });
    const ctx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: providerId, modelId: "gpt-5.4" },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    };
    await expect(runAgentLoop(
      { providers: fakeProvider([{ text: "", toolCalls: [] }], connection.db), tools: { db: connection.db, organization, chat: new ChatService(connection.db) } },
      { orgId, providerId, inputBudgetTokens: 112_000, workspaceId: null, instructions: "i", initialUserTurn: "u", toolContext: ctx },
    )).rejects.toThrow(/empty turn/);
    connection.close();
  });
});
