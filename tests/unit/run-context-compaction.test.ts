import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { capToolOutput, compactToolHistory } from "../../src/main/services/run-context-compaction";
import { runAgentLoop } from "../../src/main/services/agent-run-loop";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { IntegrationKeyStore } from "../../src/main/services/integration-key-store";
import type { AgentTurnMessage, AgentTurnResult, AssistantReplay } from "../../src/main/services/provider-tool-turn";

function toolTurn(name: string, output: string): AgentTurnMessage[] {
  const id = `c_${randomUUID()}`;
  return [
    { role: "assistant", text: "", toolCalls: [{ id, name, arguments: {} }] },
    { role: "tool", results: [{ toolCallId: id, toolName: name, output }] },
  ];
}

describe("tool history compaction", () => {
  test("keeps the three latest tool turns verbatim and previews older long outputs", () => {
    const big = (tag: string) => `${tag}:${"x".repeat(2000)}`;
    const messages: AgentTurnMessage[] = [
      { role: "user", text: "task" },
      ...toolTurn("read_file", big("first")),
      ...toolTurn("read_file", "short"),
      ...toolTurn("fetch_url", big("third")),
      ...toolTurn("read_file", big("fourth")),
      ...toolTurn("read_file", big("fifth")),
    ];
    const { messages: compacted, elided } = compactToolHistory(messages);
    expect(elided).toBe(1);
    const outputs = compacted.flatMap((message) => (message.role === "tool" ? message.results.map((result) => result.output) : []));
    expect(outputs[0]).toMatch(/^\[Earlier result of read_file elided to save context \(2006 chars\)\. It began: first:x+… Call read_file again/);
    expect(outputs[1]).toBe("short");
    expect(outputs[2]).toBe(big("third"));
    expect(outputs[3]).toBe(big("fourth"));
    expect(outputs[4]).toBe(big("fifth"));
    expect(compactToolHistory(compacted).elided).toBe(0);
  });

  test("Bedrock turns after a rewritten result lose their history-bound signature; earlier ones and Gemini signatures stay", () => {
    const replay = { format: "bedrock" as const, content: [{ reasoningContent: { reasoningText: { text: "plan", signature: "SIG" } } }] };
    const gemini = { format: "gemini" as const, content: [{ functionCall: { name: "read_file", args: {} }, thoughtSignature: "SIG" }] };
    const signed = (turn: AgentTurnMessage[], with_: AssistantReplay = replay) => turn.map((message) => (message.role === "assistant" ? { ...message, replay: with_ } : message));
    const messages: AgentTurnMessage[] = [
      { role: "user", text: "task" },
      ...signed(toolTurn("read_file", "x".repeat(2000))),
      ...signed(toolTurn("read_file", "short")),
      ...signed(toolTurn("read_file", "short")),
      ...signed(toolTurn("read_file", "short")),
    ];
    const replays = compactToolHistory(messages).messages.flatMap((message) => (message.role === "assistant" ? [message.replay ?? null] : []));
    expect(replays).toEqual([replay, null, null, null]);
    expect(compactToolHistory(signed(toolTurn("read_file", "short"))).messages[0]).toMatchObject({ replay });
    const geminiTurns = [...signed(toolTurn("read_file", "x".repeat(2000)), gemini), ...signed(toolTurn("read_file", "a"), gemini), ...signed(toolTurn("read_file", "b"), gemini), ...signed(toolTurn("read_file", "c"), gemini)];
    expect(compactToolHistory(geminiTurns).messages.flatMap((message) => (message.role === "assistant" ? [message.replay] : []))).toEqual([gemini, gemini, gemini, gemini]);
  });

  test("the run loop sends compacted history to the provider", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-compact-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let agentId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "C", employeeName: "Y", mission: "m", goal: "g" });
      agentId = organization.createAgent({
        orgId, name: "Ana", role: "Analyst", department: "Operations",
        modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null,
      });
    });
    const chat = new ChatService(connection.db);
    const general = connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'general'").get(orgId) as { id: string };
    chat.sendMessage({ orgId, spaceId: general.id, threadId: null, senderType: "agent", senderId: agentId, bodyMd: "y".repeat(3000), attachmentFileIds: [] });
    const sent: AgentTurnMessage[][] = [];
    let turn = 0;
    const result = await runAgentLoop(
      {
        providers: {
          integrationKeys: new IntegrationKeyStore(connection.db),
          runToolTurn: async (input): Promise<AgentTurnResult & { requestId: string }> => {
            sent.push(input.messages.map((message) => ({ ...message })));
            turn += 1;
            return turn <= 5
              ? { text: "", toolCalls: [{ id: `c${turn}`, name: "read_messages", arguments: { channel: "general" } }], rawResponseJson: "{}", requestId: `r${turn}` }
              : { text: "done", toolCalls: [], rawResponseJson: "{}", requestId: `r${turn}` };
          },
        },
        tools: { db: connection.db, organization, chat },
      },
      {
        orgId, providerId: "p", inputBudgetTokens: 112_000, workspaceId: null, instructions: "i", initialUserTurn: "go",
        toolContext: { orgId, agent: { id: agentId, modelProviderId: null, modelId: null }, taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null },
      },
    );
    expect(result.finalText).toBe("done");
    const outputs = sent[5].flatMap((message) => (message.role === "tool" ? message.results.map((item) => item.output) : []));
    expect(outputs).toHaveLength(5);
    expect(outputs.slice(0, 2).every((output) => output.startsWith("[Earlier result of read_messages elided"))).toBe(true);
    expect(outputs.slice(2).every((output) => output.includes("y".repeat(3000)))).toBe(true);
    connection.close();
  });

  test("every tool result is capped with a note that names the tool and the full size", () => {
    expect(capToolOutput("composio_gmail_list", "short")).toBe("short");
    const capped = capToolOutput("composio_gmail_list", "r".repeat(40_000));
    expect(capped.length).toBeLessThan(26_200);
    expect(capped.endsWith("[result of composio_gmail_list cut at 26000 of 40000 characters; ask for less (filters, pagination, fewer fields)]")).toBe(true);
  });
});
