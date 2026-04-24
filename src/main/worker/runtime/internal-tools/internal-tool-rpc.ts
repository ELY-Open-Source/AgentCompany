/**
 * RPC contract for internal (main-side) agent tools.
 *
 * The worker constructs pi `AgentTool` instances whose `execute` method
 * proxies to main via `WorkerRpcClient.invoke(runId, "invokeInternalTool",
 * payload)`. Main answers from `RuntimeBridge.handleRpc` by dispatching
 * to the handler registered for `toolName`. Handlers live on main because
 * they need the SQLite connection, approval subsystem, and telemetry —
 * none of which the worker should replicate.
 *
 * This mirrors the `beforeToolCall` RPC envelope in `hook-rpc.ts`:
 * a minimal tool-call payload crosses the worker boundary and main owns
 * the business effect. Keeping the payload shape minimal (name + JSON
 * args) mirrors pi's `ToolCall` structure so adding a new internal tool
 * requires no new RPC method — only a new handler entry.
 */

export interface InvokeInternalToolRpcPayload {
  toolName: string;
  toolCallId: string;
  args: unknown;
}

/**
 * Result envelope returned by the main-side handler.
 *
 * Carries the tool's textual output (what the model sees on the next
 * turn) plus an `isError` discriminator. `details` is optional
 * structured context the renderer can attach to the tool-call card;
 * omit it when the tool's response is purely textual.
 *
 * A handler that wants to surface a validation failure throws a
 * `UserInputError`; `RuntimeBridge` translates the throw into an
 * `{ ok: false, error }` RPC envelope, and the worker-side tool wrapper
 * converts that back into a pi tool-error result. That path keeps every
 * internal-tool failure mode aligned with pi's own tool-error
 * convention without teaching the worker about AppError classes.
 */
export interface InvokeInternalToolRpcResult {
  content: { type: "text"; text: string }[];
  details: unknown;
  isError: boolean;
}
