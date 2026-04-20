/**
 * Factory that assembles a `pi-agent-core` Agent from a prepared worker
 * job. Encapsulates the full Pi contract (initial state, sessionId,
 * thinkingLevel, beforeToolCall / afterToolCall / transformContext
 * hooks, streamFn) so `worker-runner` stays focused on run lifecycle.
 *
 * The three tool-execution hooks proxy into main via the worker RPC
 * client; main answers from `RuntimeBridge`. Pi's loop is tolerant of
 * thrown hooks — a thrown `beforeToolCall` produces an error tool
 * result, a thrown `afterToolCall` likewise — so RPC failures degrade
 * to a deterministic tool-error instead of crashing the run. The
 * `transformContext` contract explicitly forbids throwing, so on RPC
 * failure we return the original messages unchanged.
 */

import {
  Agent,
  type AfterToolCallResult,
  type AgentMessage,
  type BeforeToolCallResult,
  type ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import { streamSimple, type Api, type Model } from "@mariozechner/pi-ai";
import type {
  AfterToolCallRpcPayload,
  AfterToolCallRpcResult,
  BeforeToolCallRpcPayload,
  BeforeToolCallRpcResult,
  TransformContextRpcPayload,
  TransformContextRpcResult,
} from "@main/agent-runtime/hook-rpc";
import type { WorkerRpcClient } from "../entry/rpc";
// Side-effect import: drags the hook signature contract into the typecheck
// graph so any drift in pi-agent-core hook shapes breaks the build here.
import "./pi-hook-contract";

export interface PiAgentFactoryInput {
  runId: string;
  taskSessionId: string;
  systemPrompt: string;
  model: Model<Api>;
  tools: never;
  priorMessages: AgentMessage[];
  thinkingLevel: ThinkingLevel;
  apiKey: string;
  extraHeaders: Record<string, string> | undefined;
  rpc: WorkerRpcClient;
}

/** Map the UI-facing `thinkingEffort` string onto pi's `ThinkingLevel`. */
export function resolveThinkingLevel(effort: string | null | undefined): ThinkingLevel {
  switch (effort) {
    case "minimal":
      return "minimal";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "xhigh";
    default:
      return "off";
  }
}

export function createPiAgent(input: PiAgentFactoryInput): Agent {
  const { runId, rpc } = input;
  return new Agent({
    initialState: {
      systemPrompt: input.systemPrompt,
      model: input.model,
      tools: input.tools,
      messages: input.priorMessages,
      thinkingLevel: input.thinkingLevel,
    },
    sessionId: input.taskSessionId,
    streamFn: (model, messages, options) =>
      streamSimple(model, messages, {
        ...options,
        apiKey: input.apiKey,
        headers: { ...(options?.headers ?? {}), ...(input.extraHeaders ?? {}) },
      }),
    beforeToolCall: async (ctx): Promise<BeforeToolCallResult | undefined> => {
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
    },
    afterToolCall: async (ctx): Promise<AfterToolCallResult | undefined> => {
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
    },
    transformContext: async (messages): Promise<AgentMessage[]> => {
      const payload: TransformContextRpcPayload = { messages };
      const response = await rpc.invoke(runId, "transformContext", payload);
      if (!response.ok) return messages;
      const result = response.result as TransformContextRpcResult;
      if (result.changed && result.messages) return result.messages;
      return messages;
    },
  });
}
