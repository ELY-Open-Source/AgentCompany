import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { JsonRecord, ProviderEventStreamMessage } from "../../src/main/services/provider-http";
import type { AgentTurnMessage } from "../../src/main/services/provider-tool-turn";
import { accumulateResponsesStream, parseResponsesOutput, toResponsesInput } from "../../src/main/services/provider-tool-turns/responses-format";
import { parseChatChoice, toChatMessages } from "../../src/main/services/provider-tool-turns/chat-format";
import { parseAnthropicContent, toAnthropicMessages } from "../../src/main/services/provider-tool-turns/anthropic-format";
import { accumulateGeminiStream, antigravityRequestBody } from "../../src/main/services/provider-tool-turns/gemini-format";
import { selectToolTurn, supportsToolTurn } from "../../src/main/services/provider-tool-turns/router";
import { resolveTurnCredential } from "../../src/main/services/provider-tool-turns/credential-resolver";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { AuthBrokerService } from "../../src/main/services/auth-broker-service";
import { loadConfiguredProvider } from "../../src/main/services/provider-internal";

const CONVO: AgentTurnMessage[] = [
  { role: "user", text: "do it" },
  { role: "assistant", text: "calling", toolCalls: [{ id: "c1", name: "hire_agent", arguments: { name: "Sam" } }] },
  { role: "tool", results: [{ toolCallId: "c1", toolName: "hire_agent", output: "ok" }] },
];

async function* stream(items: JsonRecord[]): AsyncIterable<ProviderEventStreamMessage> {
  for (const data of items) yield { eventName: null, data, rawData: JSON.stringify(data) };
}

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("openai responses encoding", () => {
  test("encodes the conversation and tool calls", () => {
    expect(toResponsesInput(CONVO)).toEqual([
      { role: "user", content: [{ type: "input_text", text: "do it" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "calling", annotations: [] }] },
      { type: "function_call", call_id: "c1", name: "hire_agent", arguments: JSON.stringify({ name: "Sam" }) },
      { type: "function_call_output", call_id: "c1", output: "ok" },
    ]);
  });

  test("parses output text and function calls", () => {
    const data = { output: [
      { type: "message", content: [{ type: "output_text", text: "done" }] },
      { type: "function_call", call_id: "c2", name: "create_task", arguments: '{"title":"x"}' },
    ] };
    expect(parseResponsesOutput(data)).toEqual({ text: "done", toolCalls: [{ id: "c2", name: "create_task", arguments: { title: "x" } }] });
  });

  test("accumulates the SSE completion event", async () => {
    const result = await accumulateResponsesStream(stream([
      { type: "response.output_text.delta", delta: "partial" },
      { type: "response.completed", response: { output: [{ type: "function_call", call_id: "c3", name: "write_deliverable", arguments: '{"path":"a"}' }] } },
    ]));
    expect(result.toolCalls).toEqual([{ id: "c3", name: "write_deliverable", arguments: { path: "a" } }]);
  });
});

describe("openai chat completions encoding", () => {
  test("encodes system, tool calls and tool results", () => {
    expect(toChatMessages("sys", CONVO)).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "do it" },
      { role: "assistant", content: "calling", tool_calls: [{ id: "c1", type: "function", function: { name: "hire_agent", arguments: JSON.stringify({ name: "Sam" }) } }] },
      { role: "tool", tool_call_id: "c1", content: "ok" },
    ]);
  });

  test("parses a tool call choice", () => {
    const data = { choices: [{ message: { content: "hi", tool_calls: [{ id: "c9", function: { name: "f", arguments: '{"a":1}' } }] } }] };
    expect(parseChatChoice(data)).toEqual({ text: "hi", toolCalls: [{ id: "c9", name: "f", arguments: { a: 1 } }] });
  });
});

describe("anthropic encoding", () => {
  test("encodes tool_use and tool_result", () => {
    expect(toAnthropicMessages(CONVO)).toEqual([
      { role: "user", content: [{ type: "text", text: "do it" }] },
      { role: "assistant", content: [{ type: "text", text: "calling" }, { type: "tool_use", id: "c1", name: "hire_agent", input: { name: "Sam" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "ok" }] },
    ]);
  });

  test("parses text and tool_use blocks", () => {
    const data = { content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "tu", name: "f", input: { x: 1 } }] };
    expect(parseAnthropicContent(data)).toEqual({ text: "ok", toolCalls: [{ id: "tu", name: "f", arguments: { x: 1 } }] });
  });
});

describe("antigravity (gemini) encoding", () => {
  test("wraps the request with the Antigravity system instruction and tool declarations", () => {
    const body = antigravityRequestBody({ model: "claude-sonnet-4-5", projectId: "proj", instructions: "be helpful", messages: CONVO, tools: [{ name: "f", description: "d", parameters: { type: "object" } }], requestId: "agent-1" });
    expect(body.project).toBe("proj");
    expect(body.requestType).toBe("agent");
    expect(body.userAgent).toBe("antigravity");
    const request = body.request as JsonRecord;
    const system = request.systemInstruction as { role: string; parts: Array<{ text: string }> };
    expect(system.role).toBe("user");
    expect(system.parts[0].text).toContain("You are Antigravity");
    expect(system.parts[system.parts.length - 1].text).toBe("be helpful");
    // claude-* models use the legacy `parameters` field
    expect(request.tools).toEqual([{ functionDeclarations: [{ name: "f", description: "d", parameters: { type: "object" } }] }]);
  });

  test("gemini models use parametersJsonSchema and omit the tool-call id", () => {
    const body = antigravityRequestBody({ model: "gemini-3.1-pro-high", projectId: "proj", instructions: null, messages: CONVO, tools: [{ name: "f", description: "d", parameters: { type: "object" } }], requestId: "agent-2" });
    const request = body.request as JsonRecord;
    expect(request.tools).toEqual([{ functionDeclarations: [{ name: "f", description: "d", parametersJsonSchema: { type: "object" } }] }]);
    const contents = request.contents as Array<{ role: string; parts: Array<JsonRecord> }>;
    const assistant = contents.find((c) => c.role === "model");
    const fnCall = assistant?.parts.find((p) => "functionCall" in p)?.functionCall as JsonRecord;
    expect(fnCall.id).toBeUndefined();
  });

  test("accumulates streamed candidates", async () => {
    const result = await accumulateGeminiStream(stream([
      { response: { candidates: [{ content: { parts: [{ text: "hello" }, { functionCall: { name: "f", args: { x: 1 }, id: "g1" } }] } }] } },
    ]));
    expect(result.text).toBe("hello");
    expect(result.toolCalls).toEqual([{ id: "g1", name: "f", arguments: { x: 1 } }]);
  });
});

describe("tool-turn router", () => {
  test("supports every agent-capable provider and rejects cloud-only ones", () => {
    for (const key of ["openai", "anthropic", "xai", "groq", "mistral", "cerebras", "openrouter", "gpt-account", "github-copilot", "google-antigravity", "claude-pro"]) {
      expect(supportsToolTurn(key)).toBe(true);
      expect(typeof selectToolTurn(key)).toBe("function");
    }
    for (const key of ["azure-openai", "aws-bedrock", "vertex-ai"]) {
      expect(supportsToolTurn(key)).toBe(false);
      expect(() => selectToolTurn(key)).toThrow();
    }
  });
});

describe("credential resolver", () => {
  test("returns the api key for api-key providers and the access token for fresh OAuth", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-cred-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const providers = new ProviderService(connection.db, providerAdapters, testVault);
    const authBroker = new AuthBrokerService(connection.db, testVault);
    let orgId = "";
    let openaiId = "";
    let gptAccountId = "";
    const future = Date.now() + 60 * 60 * 1000;
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      openaiId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      gptAccountId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'gpt-account'").get(orgId) as { id: string }).id;
      providers.saveCredential({ orgId, providerId: openaiId, secret: "sk-live", model: "gpt-5.4" });
      providers.saveCredential({ orgId, providerId: gptAccountId, secret: JSON.stringify({ access: "tok", refresh: "r", expires: future, accountId: "acct_1" }), model: "gpt-5.4" });
    });

    return (async () => {
      const apiKeyCred = await resolveTurnCredential({ authBroker, orgId, provider: loadConfiguredProvider(connection.db, orgId, openaiId) });
      expect(apiKeyCred).toEqual({ apiKey: "sk-live" });
      const oauthCred = await resolveTurnCredential({ authBroker, orgId, provider: loadConfiguredProvider(connection.db, orgId, gptAccountId) });
      expect(oauthCred.accessToken).toBe("tok");
      expect(oauthCred.accountId).toBe("acct_1");
      connection.close();
    })();
  });
});
