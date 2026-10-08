import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { estimateTokens, inputBudgetTokens, skillBudgetTokens } from "../../src/main/services/context-budget";
import { runAgentLoop } from "../../src/main/services/agent-run-loop";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { IntegrationKeyStore } from "../../src/main/services/integration-key-store";
import { ProviderService } from "../../src/main/services/provider-service";
import type { AgentTurnMessage, AgentTurnResult } from "../../src/main/services/provider-tool-turn";
import { AGENT_TOOLS } from "../../src/main/services/agent-tools";
import { WORKSPACE_TOOLS } from "../../src/main/services/agent-workspace-tools";
import { WEB_TOOLS } from "../../src/main/services/agent-web-tools";

const FIXED_TOKENS = estimateTokens("i") + estimateTokens(JSON.stringify([...AGENT_TOOLS, ...WORKSPACE_TOOLS, ...WEB_TOOLS]));

describe("token estimates", () => {
  test("count CJK per character and other text per three characters", () => {
    expect(estimateTokens("abcdef")).toBe(2);
    expect(estimateTokens("abcdefg")).toBe(3);
    expect(estimateTokens("技能规则")).toBe(4);
    expect(estimateTokens("规则 rule")).toBe(4);
    expect(inputBudgetTokens(128_000)).toBe(112_000);
    expect(skillBudgetTokens(128_000)).toBe(44_800);
  });
});

async function loop(budget: number, sent: AgentTurnMessage[][]) {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-budget-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let agentId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "B", employeeName: "Y", mission: "m", goal: "g" });
    agentId = organization.createAgent({ orgId, name: "Ana", role: "Analyst", department: "Operations", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null });
  });
  const chat = new ChatService(connection.db);
  const general = connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'general'").get(orgId) as { id: string };
  chat.sendMessage({ orgId, spaceId: general.id, threadId: null, senderType: "agent", senderId: agentId, bodyMd: "y".repeat(9000), attachmentFileIds: [] });
  let turn = 0;
  try {
    return await runAgentLoop(
      {
        providers: {
          integrationKeys: new IntegrationKeyStore(connection.db),
          runToolTurn: async (input): Promise<AgentTurnResult & { requestId: string }> => {
            sent.push(input.messages.map((message) => ({ ...message })));
            turn += 1;
            return turn <= 2
              ? { text: "", toolCalls: [{ id: `c${turn}`, name: "read_messages", arguments: { channel: "general" } }], rawResponseJson: "{}", requestId: `r${turn}` }
              : { text: "done", toolCalls: [], rawResponseJson: "{}", requestId: `r${turn}` };
          },
        },
        tools: { db: connection.db, organization, chat },
      },
      {
        orgId, providerId: "p", inputBudgetTokens: budget, workspaceId: null, instructions: "i", initialUserTurn: "go",
        toolContext: { orgId, agent: { id: agentId, modelProviderId: null, modelId: null }, taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null },
      },
    );
  } finally {
    connection.close();
  }
}

describe("run context budget", () => {
  test("over budget, older tool results are elided before the next call", async () => {
    const sent: AgentTurnMessage[][] = [];
    const result = await loop(FIXED_TOKENS + 5_000, sent);
    expect(result.finalText).toBe("done");
    const outputs = sent[2].flatMap((message) => (message.role === "tool" ? message.results.map((item) => item.output) : []));
    expect(outputs[0]).toMatch(/^\[Earlier result of read_messages elided/);
    expect(outputs[1]).toContain("y".repeat(9000));
  });

  test("a request that cannot fit even after compaction fails loudly with the numbers", async () => {
    await expect(loop(2_000, [])).rejects.toThrow(/This run needs ~\d+ input tokens but the provider's context window leaves 2000/);
  });

  test("the provider context window has a floor", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-window-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "W", employeeName: "Y", mission: "m", goal: "g" });
    });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    const providers = new ProviderService(connection.db);
    const policy = { orgId, providerId, dataPolicy: "standard" as const, backgroundEnabled: false, monthlyRequestLimit: 100, workspaceScope: "organization" as const };
    expect(() => providers.updatePolicy({ ...policy, contextWindowTokens: 8_000 })).toThrow("Context window must be at least 24000 tokens.");
    providers.updatePolicy({ ...policy, contextWindowTokens: 200_000 });
    expect(connection.db.prepare("select context_window_tokens from providers where id = ?").get(providerId)).toEqual({ context_window_tokens: 200_000 });
    connection.close();
  });
});
