/**
 * Aggregated factory for the three pi-agent-core tool-execution hooks
 * installed by `pi-agent-factory.createPiAgent`.
 *
 * Before this module the factory wired `beforeToolCall` / `afterToolCall`
 * / `transformContext` as three inline closures, each re-establishing
 * its own RPC envelope shape and its own error policy. A new hook (or
 * a signature change in pi) meant touching the factory in three places,
 * and the "what does each hook do on failure?" matrix lived only in
 * reader memory.
 *
 * `buildAgentHooks` collapses the wiring into a single object whose
 * shape mirrors the subset of `AgentOptions` that we populate. The
 * factory spreads the result into `new Agent({...})`, so the agent
 * contract is still the pi-defined one — this is a pure organizational
 * refactor. Behavior (RPC shapes, failure modes, tool-name semantics)
 * is preserved verbatim by routing through the same `WorkerRpcClient`
 * the factory previously held.
 *
 * The signatures below are pinned to pi via `pi-hook-contract`: any
 * drift in `AgentOptions.beforeToolCall` / `afterToolCall` /
 * `transformContext` breaks the build on the contract file, so the
 * aggregation cannot silently drift from upstream.
 */

import type {
  AfterToolCallResult,
  AgentMessage,
  AgentOptions,
  BeforeToolCallResult,
} from "@mariozechner/pi-agent-core";
import type {
  AfterToolCallRpcPayload,
  AfterToolCallRpcResult,
  BeforeToolCallRpcPayload,
  BeforeToolCallRpcResult,
  TransformContextRpcPayload,
  TransformContextRpcResult,
} from "./hook-rpc";
import type { WorkerRpcClient } from "../worker/entry/rpc";

/**
 * Inputs the aggregator needs to produce a hook bundle. `rpc` is the
 * worker-side RPC client that ships hook invocations back to main
 * where the actual policy (approval gate, artifact projection, context
 * compaction) lives. `runId` is the routing key main uses to look up
 * the per-run `ActiveRunContext` in `RuntimeBridge`.
 */
export interface AgentHooksDeps {
  runId: string;
  rpc: WorkerRpcClient;
}

/**
 * Subset of `AgentOptions` the aggregator populates. Exposed as an
 * explicit interface so the factory call site keeps a stable shape
 * even when pi adds further option slots — anything not in here stays
 * the factory's own responsibility.
 */
export interface AgentHookBundle {
  beforeToolCall: NonNullable<AgentOptions["beforeToolCall"]>;
  afterToolCall: NonNullable<AgentOptions["afterToolCall"]>;
  transformContext: NonNullable<AgentOptions["transformContext"]>;
}

/**
 * Build the three pi-agent-core hooks as a single bundle.
 *
 * Each hook's behavior matches the pre-aggregation inline closures in
 * `pi-agent-factory`:
 *
 *  - `beforeToolCall`: fail-closed RPC. A thrown error travels up into
 *    pi's loop and surfaces as a tool-error result — destructive tools
 *    must never silently bypass main's approval gate.
 *  - `afterToolCall`: fail-open RPC. Projection is observational; if
 *    main cannot be reached the tool result stands unchanged.
 *  - `transformContext`: fail-open RPC. The pi contract forbids throws
 *    here, so on RPC failure we return the original transcript.
 */
export function buildAgentHooks(deps: AgentHooksDeps): AgentHookBundle {
  const { runId, rpc } = deps;

  const beforeToolCall: AgentHookBundle["beforeToolCall"] = async (
    ctx,
  ): Promise<BeforeToolCallResult | undefined> => {
    const payload: BeforeToolCallRpcPayload = {
      toolName: ctx.toolCall.name,
      toolCallId: ctx.toolCall.id,
      args: ctx.args,
    };
    const response = await rpc.invoke(runId, "beforeToolCall", payload);
    if (!response.ok) {
      // RPC failure must fail closed for destructive tools: main is
      // the source of truth for approval state, and silently running
      // without it would bypass the gate. The loop converts the thrown
      // error into a tool-error result and surfaces it to the agent.
      throw new Error(`beforeToolCall RPC failed: ${response.error}`);
    }
    const result = response.result as BeforeToolCallRpcResult;
    if (!result.block) return undefined;
    return { block: true, reason: result.reason ?? undefined };
  };

  const afterToolCall: AgentHookBundle["afterToolCall"] = async (
    ctx,
  ): Promise<AfterToolCallResult | undefined> => {
    const payload: AfterToolCallRpcPayload = {
      toolName: ctx.toolCall.name,
      toolCallId: ctx.toolCall.id,
      args: ctx.args,
      resultContent: ctx.result.content,
      resultDetails: ctx.result.details,
      isError: ctx.isError,
    };
    const response = await rpc.invoke(runId, "afterToolCall", payload);
    if (!response.ok) {
      // After-hook failure is informational: the tool already ran,
      // projection is a best-effort write. Drop the hook rather than
      // corrupting the tool result.
      return undefined;
    }
    const result = response.result as AfterToolCallRpcResult;
    const override: AfterToolCallResult = {};
    if (result.contentOverride) override.content = result.contentOverride;
    if (result.isErrorOverride !== null) override.isError = result.isErrorOverride;
    return Object.keys(override).length === 0 ? undefined : override;
  };

  const transformContext: AgentHookBundle["transformContext"] = async (
    messages,
  ): Promise<AgentMessage[]> => {
    const payload: TransformContextRpcPayload = { messages };
    const response = await rpc.invoke(runId, "transformContext", payload);
    if (!response.ok) return messages;
    const result = response.result as TransformContextRpcResult;
    if (result.changed && result.messages) return result.messages;
    return messages;
  };

  return { beforeToolCall, afterToolCall, transformContext };
}
