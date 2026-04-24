import { describe, expect, it, vi } from "vitest";
import { buildAgentHooks } from "../../src/main/agent-runtime/agent-hooks";
import type { WorkerRpcClient } from "../../src/main/worker/entry/rpc";

function createRpc(response: { ok: true; result: unknown } | { ok: false; error: string }) {
  return {
    invoke: vi.fn(async () => response),
  } as unknown as WorkerRpcClient & { invoke: ReturnType<typeof vi.fn> };
}

describe("agent hook RPC policy", () => {
  it("fails afterToolCall when main cannot acknowledge artifact projection", async () => {
    const rpc = createRpc({ ok: false, error: "RuntimeBridge unavailable" });
    const hooks = buildAgentHooks({
      runId: "11111111-1111-4111-8111-111111111111",
      rpc,
    });

    await expect(
      hooks.afterToolCall({
        toolCall: { name: "write", id: "tool-call-1" },
        args: { path: "report.md" },
        result: { content: [], details: null },
        isError: false,
      } as unknown as Parameters<typeof hooks.afterToolCall>[0]),
    ).rejects.toThrow("afterToolCall RPC failed: RuntimeBridge unavailable");
  });
});
