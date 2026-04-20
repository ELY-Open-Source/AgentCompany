import { randomUUID } from "node:crypto";
import type { ChildMessage } from "../runtime/helpers";

interface PendingRpc {
  resolve: (value: { ok: true; result: unknown } | { ok: false; error: string }) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

export class WorkerRpcClient {
  private readonly pending = new Map<string, PendingRpc>();

  constructor(
    private readonly post: (message: ChildMessage) => void,
    private readonly timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS,
  ) {}

  invoke(
    runId: string,
    method: string,
    payload: unknown,
    options?: { timeoutMs?: number },
  ): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    const rpcId = randomUUID();
    const effectiveTimeoutMs = options?.timeoutMs ?? this.timeoutMs;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(rpcId);
        if (!pending) return;
        this.pending.delete(rpcId);
        pending.resolve({ ok: false, error: `RPC ${method} timed out after ${effectiveTimeoutMs}ms` });
      }, effectiveTimeoutMs);
      this.pending.set(rpcId, { resolve, timer });
      this.post({ type: "rpc-request", rpcId, runId, method, payload });
    });
  }

  resolve(rpcId: string, response: { ok: true; result: unknown } | { ok: false; error: string }): void {
    const pending = this.pending.get(rpcId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(rpcId);
    pending.resolve(response);
  }

  cancelAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: reason });
      this.pending.delete(id);
    }
  }
}
