import { describe, expect, it, vi } from "vitest";
import { buildAgentHooks } from "../../src/main/agent-runtime/agent-hooks";
import type { WorkerRpcClient } from "../../src/main/worker/entry/rpc";

function createRpc(response: { ok: true; result: unknown } | { ok: false; error: string }) {
  return {
    invoke: vi.fn(async () => response),
  } as unknown as WorkerRpcClient & { invoke: ReturnType<typeof vi.fn> };
}

describe("agent hook RPC policy", () => {
  it("fails beforeToolCall closed when main cannot answer approval policy", async () => {
    const rpc = createRpc({ ok: false, error: "RuntimeBridge unavailable" });
    const hooks = buildAgentHooks({
      runId: "11111111-1111-4111-8111-111111111111",
      rpc,
    });

    await expect(
      hooks.beforeToolCall({
        toolCall: { name: "bash", id: "tool-call-1" },
        args: { path: "report.md" },
      } as unknown as Parameters<typeof hooks.beforeToolCall>[0]),
    ).rejects.toThrow("beforeToolCall RPC failed: RuntimeBridge unavailable");
  });

  it("installs no per-tool artifact projection hook", () => {
    const rpc = createRpc({ ok: true, result: { block: false, reason: null } });
    const hooks = buildAgentHooks({
      runId: "11111111-1111-4111-8111-111111111111",
      rpc,
    });

    expect(Object.keys(hooks).sort()).toEqual(["beforeToolCall", "transformContext"]);
    expect("afterToolCall" in hooks).toBe(false);
  });
});
