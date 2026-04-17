import { randomUUID } from "node:crypto";
import type { ChildMessage } from "./worker-helpers";

interface PendingRpc {
  resolve: (value: { ok: true; result: unknown } | { ok: false; error: string }) => void;
}

export class WorkerRpcClient {
  private readonly pending = new Map<string, PendingRpc>();

  constructor(private readonly post: (message: ChildMessage) => void) {}

  invoke(runId: string, method: string, payload: unknown): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    const rpcId = randomUUID();
    return new Promise((resolve) => {
      this.pending.set(rpcId, { resolve });
      this.post({ type: "rpc-request", rpcId, runId, method, payload });
    });
  }

  resolve(rpcId: string, response: { ok: true; result: unknown } | { ok: false; error: string }): void {
    const pending = this.pending.get(rpcId);
    if (!pending) return;
    this.pending.delete(rpcId);
    pending.resolve(response);
  }

  cancelAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      pending.resolve({ ok: false, error: reason });
      this.pending.delete(id);
    }
  }
}
