import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { createPiAgent } from "../../src/main/worker/runtime/pi-agent-factory";
import type { WorkerRpcClient } from "../../src/main/worker/entry/rpc";

function createModel(): Model<"openai-responses"> {
  return {
    id: "mock",
    name: "mock",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 2048,
  };
}

describe("pi agent factory", () => {
  it("uses sequential tool execution for coding tools", () => {
    const agent = createPiAgent({
      runId: "run_1",
      taskSessionId: "session_1",
      systemPrompt: "You are an engineer.",
      model: createModel(),
      tools: [],
      priorMessages: [],
      thinkingLevel: "off",
      apiKey: "test-key",
      extraHeaders: undefined,
      rpc: {
        invoke: async () => {
          throw new Error("Unexpected RPC call in factory test.");
        },
      } as unknown as WorkerRpcClient,
    });

    expect(agent.toolExecution).toBe("sequential");
  });

  it("keeps worker tool arrays on the erased pi tool contract", () => {
    const runnerSource = readFileSync(join(process.cwd(), "src/main/worker/runtime/index.ts"), "utf8");
    const factorySource = readFileSync(join(process.cwd(), "src/main/worker/runtime/pi-agent-factory.ts"), "utf8");

    expect(runnerSource).not.toContain("as unknown as AgentTool");
    expect(runnerSource).not.toContain("as never");
    expect(factorySource).not.toContain("tools: never");
    expect(factorySource).toContain('type ErasedAgentTool = AgentState["tools"][number]');
  });
});
