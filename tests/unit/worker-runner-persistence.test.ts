import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import type { ChildMessage, RunJob } from "../../src/main/worker/runtime/helpers";
import type { WorkerRpcClient } from "../../src/main/worker/entry/rpc";

const createPiAgentMock = vi.fn();

vi.mock("../../src/main/model-resolver", () => ({
  resolveModel: vi.fn(() => ({
    id: "model-1",
    name: "Model 1",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 2048,
  })),
  resolveExtraStreamHeaders: vi.fn(() => undefined),
}));

vi.mock("../../src/main/worker/runtime/run-tools", () => ({
  createRunScopedCodingTools: vi.fn(() => []),
  mergeRunEnvs: vi.fn((base: Record<string, string>, extra: Record<string, string>) => ({ ...base, ...extra })),
}));

vi.mock("../../src/main/worker/runtime/pi-agent-factory", () => ({
  createPiAgent: createPiAgentMock,
  resolveThinkingLevel: vi.fn(() => "off"),
}));

async function importWorkerRunner() {
  const module = await import("../../src/main/worker/runtime");
  return module.WorkerRunner;
}

function createJob(): RunJob {
  return {
    runId: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    taskId: "task-1",
    agentId: "agent-1",
    agentName: "Agent One",
    connectorId: "openai",
    workspaceId: null,
    workspacePath: null,
    workspaceMode: "none",
    model: "model-1",
    thinkingEffort: null,
    env: {},
    systemPrompt: "system",
    trigger: "manual",
    taskSessionId: "session-1",
    executionMode: "ai_ceo",
    initialUserTurn: "Start.",
    internalTools: [],
  };
}

function assistantMessage(): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "done" }],
    api: "openai-responses",
    provider: "openai",
    model: "model-1",
    timestamp: 1,
    stopReason: "stop",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.01,
      },
    },
  };
}

function createAgentEmitting(message: AgentMessage) {
  let listener: ((event: { type: string; message?: AgentMessage }, signal: AbortSignal) => Promise<void>) | null = null;
  return {
    abort: vi.fn(),
    steer: vi.fn(),
    subscribe: vi.fn((nextListener) => {
      listener = nextListener;
      return vi.fn();
    }),
    prompt: vi.fn(async () => {
      if (!listener) throw new Error("Agent subscribed after prompt.");
      await listener({ type: "message_end", message }, new AbortController().signal);
    }),
  };
}

function createRpcWithPersistenceFailure() {
  return {
    invoke: vi.fn(async (_runId: string, method: string) => {
      if (method === "prepareRun") {
        return {
          ok: true,
          result: {
            provider: "openai",
            apiKey: "test-key",
            extraEnv: {},
            priorMessages: [],
          },
        };
      }
      if (method === "persistMessage") {
        return { ok: false, error: "append failed" };
      }
      throw new Error(`Unexpected RPC method ${method}.`);
    }),
  } as unknown as WorkerRpcClient & { invoke: ReturnType<typeof vi.fn> };
}

describe("WorkerRunner message persistence", () => {
  it("fails the run when persisting an emitted message fails", async () => {
    createPiAgentMock.mockReturnValue(createAgentEmitting(assistantMessage()));
    const rpc = createRpcWithPersistenceFailure();
    const messages: ChildMessage[] = [];
    const WorkerRunner = await importWorkerRunner();
    const runner = new WorkerRunner({
      post: (message) => messages.push(message),
      rpc,
      isCancelled: () => false,
    });

    await runner.run(createJob());

    const finished = messages.find((message): message is Extract<ChildMessage, { type: "run-finished" }> => {
      return message.type === "run-finished";
    });

    expect(rpc.invoke).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "persistMessage", {
      taskSessionId: "session-1",
      message: assistantMessage(),
    });
    expect(finished).toMatchObject({
      type: "run-finished",
      status: "failed",
      errorMessage: "persistMessage RPC failed: append failed",
    });
  });
});
