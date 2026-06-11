import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { runAgentLoop } from "../../src/main/services/agent-run-loop";
import type { AgentToolContext } from "../../src/main/services/agent-tools";
import type { AgentTurnResult, ToolCall } from "../../src/main/services/provider-tool-turn";

interface ScriptedTurn {
  text: string;
  toolCalls: ToolCall[];
}

function fakeProvider(script: ScriptedTurn[]) {
  let index = 0;
  return {
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

/** Mimics a weak model: it rambles in prose and skips tools unless the backend
 * compels a tool call. With forcing it posts a kickoff message, then stops. */
function weakModelProvider() {
  let forced = false;
  return {
    runToolTurn: async (input: { toolChoice?: "auto" | "required" }): Promise<AgentTurnResult & { requestId: string }> => {
      if (input.toolChoice === "required" && !forced) {
        forced = true;
        return { text: "Acting.", toolCalls: [call("send_message", { channel: "general", body: "Kicking off the company." })], rawResponseJson: "{}", requestId: "req_forced" };
      }
      return { text: "Let me think about this some more.", toolCalls: [], rawResponseJson: "{}", requestId: "req_prose" };
    },
  };
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
      taskGoalId: null,
      workspace: { id: workspaceId, localPath: workspaceRoot },
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
        providers: fakeProvider(script),
        tools: { db: connection.db, organization, chat: new ChatService(connection.db) },
        onToolResults: () => { toolResultNotifications += 1; },
      },
      { orgId, providerId, workspaceId, instructions: "You are the CEO.", initialUserTurn: "Start the company.", toolContext },
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

    // The CEO's coordination message lands in #general so the channel is no longer blank.
    const generalSpaceId = (connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'general'").get(orgId) as { id: string }).id;
    const messages = connection.db.prepare(
      "select sender_type, sender_id, body_md, space_id from chat_messages where org_id = ?",
    ).all(orgId) as Array<{ sender_type: string; sender_id: string; body_md: string; space_id: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ sender_type: "agent", sender_id: ceoId, space_id: generalSpaceId });
    expect(messages[0]?.body_md).toContain("operating plan is live");

    connection.close();
  });

  test("forcing the opening turn makes a weak model act instead of completing a no-op", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-weak-${randomUUID()}.db`));
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
      taskProjectId: null, taskGoalId: null, workspace: null,
    };
    const result = await runAgentLoop(
      { providers: weakModelProvider(), tools: { db: connection.db, organization, chat: new ChatService(connection.db) } },
      { orgId, providerId, workspaceId: null, instructions: "You are the CEO.", initialUserTurn: "Start the company.", toolContext: ctx },
    );
    // The loop forced the opening turn, so the otherwise-rambling model acted.
    expect(result.toolCallCount).toBe(1);
    const messages = connection.db.prepare("select sender_id from chat_messages where org_id = ?").all(orgId) as Array<{ sender_id: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.sender_id).toBe(ceoId);
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
      taskProjectId: null, taskGoalId: null, workspace: { id: "wsp", localPath: workspaceRoot },
    };
    const script: ScriptedTurn[] = [
      { text: "escape", toolCalls: [call("write_deliverable", { path: "../escape.txt", content: "x" })] },
      { text: "done", toolCalls: [] },
    ];
    const result = await runAgentLoop(
      { providers: fakeProvider(script), tools: { db: connection.db, organization, chat: new ChatService(connection.db) } },
      { orgId, providerId, workspaceId: null, instructions: "i", initialUserTurn: "u", toolContext: ctx },
    );
    // The tool returns an error string to the model; nothing is written outside the root.
    expect(existsSync(join(workspaceRoot, "..", "escape.txt"))).toBe(false);
    expect(result.toolCallCount).toBe(1);
    connection.close();
  });

  test("a first turn that takes no action (prose only, no tool calls) fails the run", async () => {
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
      taskProjectId: null, taskGoalId: null, workspace: null,
    };
    // A weak model that answers the kickoff with prose and zero tool calls must
    // not be recorded as a success — the forced first turn produced no action.
    await expect(runAgentLoop(
      { providers: fakeProvider([{ text: "Here is my plan: first I will think about it.", toolCalls: [] }]), tools: { db: connection.db, organization, chat: new ChatService(connection.db) } },
      { orgId, providerId, workspaceId: null, instructions: "i", initialUserTurn: "u", toolContext: ctx },
    )).rejects.toThrow(/no action on its first turn/);
    connection.close();
  });
});
