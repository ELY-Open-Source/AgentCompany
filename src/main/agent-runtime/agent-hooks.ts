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
 * contract is still the pi-defined one. Tool policy stays routed
 * through `WorkerRpcClient`; context compaction runs inside the worker
 * so the full transcript never crosses the worker-main boundary.
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
} from "./hook-rpc";
import type { WorkerRpcClient } from "../worker/entry/rpc";
import {
  compactMessagesIfNeeded,
  type CompactionTelemetry,
} from "./context-compactor";

export interface ContextCompactionTelemetry extends CompactionTelemetry {
  runId: string;
  emittedAt: string;
}

/**
 * Inputs the aggregator needs to produce a hook bundle. `rpc` is the
 * worker-side RPC client that ships policy hook invocations back to
 * main. `runId` is the routing key main uses to look up the per-run
 * `ActiveRunContext` in `RuntimeBridge`.
 */
export interface AgentHooksDeps {
  runId: string;
  rpc: WorkerRpcClient;
  onContextCompaction?: (telemetry: ContextCompactionTelemetry) => void;
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
 *  - `afterToolCall`: fail-closed RPC. The tool has already run, so
 *    main must durably acknowledge the artifact projection result.
 *  - `transformContext`: worker-local compaction. The transcript stays
 *    inside the worker; main receives telemetry only.
 */
export function buildAgentHooks(deps: AgentHooksDeps): AgentHookBundle {
  const { runId, rpc, onContextCompaction } = deps;

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
      throw new Error(`afterToolCall RPC failed: ${response.error}`);
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
    try {
      const outcome = compactMessagesIfNeeded(messages);
      if (outcome.changed && outcome.messages) {
        if (outcome.telemetry) {
          onContextCompaction?.({
            ...outcome.telemetry,
            runId,
            emittedAt: new Date().toISOString(),
          });
        }
        return outcome.messages;
      }
      return messages;
    } catch (error) {
      throw new Error(
        `transformContext compaction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return { beforeToolCall, afterToolCall, transformContext };
}
