import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { buildAgentHooks } from "../../src/main/agent-runtime/agent-hooks";
import type { WorkerRpcClient } from "../../src/main/worker/entry/rpc";

function createRpc() {
  return {
    invoke: vi.fn(async () => ({ ok: true, result: undefined })),
  } as unknown as WorkerRpcClient & { invoke: ReturnType<typeof vi.fn> };
}

function largeTranscript(): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < 46; i += 1) {
    const role = i % 2 === 0 ? "user" : "assistant";
    messages.push({
      role,
      content: [{
        type: "text",
        text: `${role} turn ${i}\n${"context ".repeat(6_000)}`,
      }],
      timestamp: i,
    } as AgentMessage);
  }
  return messages;
}

describe("worker-side context compaction", () => {
  it("compacts inside the worker without transformContext RPC", async () => {
    const rpc = createRpc();
    const onContextCompaction = vi.fn();
    const hooks = buildAgentHooks({
      runId: "8b3f07b2-841a-4e16-9d1c-9d2a27c3c2ad",
      rpc,
      onContextCompaction,
    });

    const messages = largeTranscript();
    const transformed = await hooks.transformContext(messages);

    expect(rpc.invoke).not.toHaveBeenCalledWith(
      expect.any(String),
      "transformContext",
      expect.anything(),
    );
    expect(transformed.length).toBeLessThan(messages.length);
    expect(transformed[0]).toMatchObject({ role: "user" });
    expect(onContextCompaction).toHaveBeenCalledWith(expect.objectContaining({
      runId: "8b3f07b2-841a-4e16-9d1c-9d2a27c3c2ad",
      originalMessageCount: messages.length,
      compactedMessageCount: transformed.length,
    }));
  });

  it("propagates compaction failures instead of returning the original transcript", async () => {
    const rpc = createRpc();
    const hooks = buildAgentHooks({
      runId: "b9f6aa93-0db7-4f39-8f28-2d87742ef414",
      rpc,
    });

    await expect(hooks.transformContext(null as unknown as AgentMessage[])).rejects.toThrow(
      "transformContext compaction failed",
    );
  });
});
