/**
 * Factory that assembles a `pi-agent-core` Agent from a prepared worker
 * job. Encapsulates the full Pi contract (initial state, sessionId,
 * thinkingLevel, beforeToolCall / transformContext
 * hooks, streamFn) so `worker-runner` stays focused on run lifecycle.
 *
 * `beforeToolCall` proxies into main via the worker RPC client; main
 * answers from `RuntimeBridge`. Pi's loop is tolerant of thrown hooks,
 * so approval RPC failures degrade to a deterministic tool-error. The
 * `transformContext` hook runs the deterministic compactor in the worker
 * process and lets compaction failures fail the run explicitly.
 */

import {
  Agent,
  type AgentMessage,
  type AgentState,
  type ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import { buildAgentHooks } from "@main/agent-runtime/agent-hooks";
import type { ContextCompactionTelemetry } from "@main/agent-runtime/agent-hooks";
import type { WorkerRpcClient } from "../entry/rpc";
import { safeStreamSimple } from "./pi-safe-stream";
// Side-effect import: drags the hook signature contract into the typecheck
// graph so any drift in pi-agent-core hook shapes breaks the build here.
import "./pi-hook-contract";

export type ErasedAgentTool = AgentState["tools"][number];

export interface PiAgentFactoryInput {
  runId: string;
  taskSessionId: string;
  systemPrompt: string;
  model: Model<Api>;
  tools: ErasedAgentTool[];
  priorMessages: AgentMessage[];
  thinkingLevel: ThinkingLevel;
  apiKey: string;
  extraHeaders: Record<string, string> | undefined;
  rpc: WorkerRpcClient;
  onContextCompaction?: (telemetry: ContextCompactionTelemetry) => void;
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
  const hooks = buildAgentHooks({
    runId: input.runId,
    rpc: input.rpc,
    onContextCompaction: input.onContextCompaction,
  });
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
      safeStreamSimple(model, messages, {
        ...options,
        apiKey: input.apiKey,
        headers: { ...(options?.headers ?? {}), ...(input.extraHeaders ?? {}) },
      }),
    beforeToolCall: hooks.beforeToolCall,
    transformContext: hooks.transformContext,
    toolExecution: "sequential",
  });
}
