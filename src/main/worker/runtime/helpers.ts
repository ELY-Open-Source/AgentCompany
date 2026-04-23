import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { RunStatus, RunUsageStatus } from "@shared/types";

export interface RunJob {
  runId: string;
  companyId: string;
  /** Null for heartbeat runs with no assigned task. Must stay aligned with EnqueueRunPayload. */
  taskId: string | null;
  agentId: string;
  agentName: string;
  connectorId: string;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceMode: "exclusive" | "shared" | "none";
  model: string | null;
  thinkingEffort: string | null;
  env: Record<string, string>;
  systemPrompt: string | null;
  trigger: string | null;
  taskSessionId: string;
  executionMode: "ai_ceo" | "ai_cofounder";
  /** Seed user turn that kicks off the pi agent loop. Never empty. */
  initialUserTurn: string;
  /**
   * Internal tools (`hire_agent`, `file_approval`) to register on this
   * run's agent in addition to the default coding tools. Determined on
   * main side before enqueue so the worker never needs to inspect
   * company/agent state. Empty array = no extra tools.
   */
  internalTools: ReadonlyArray<"hire_agent" | "file_approval">;
}

/**
 * Parent → worker control-plane messages. `steer-run` is the inward half
 * of pi's mid-run injection contract: the worker owns the Agent instance,
 * main owns the inbox DB, so main posts the enqueued user message here and
 * the worker calls `agent.steer()`.
 *
 * `correlationId` pairs each steer with a `steer-ack` child reply so main
 * can hold the "inbox delivered" write until the worker has queued the
 * message onto the live Agent. Without the ACK, a steer that lost the
 * race against run teardown would be silently dropped after main already
 * marked the row delivered.
 */
export type RunAgentLifecycleState = "agent_active" | "closing";

export type ParentMessage =
  | { type: "enqueue-run"; payload: RunJob }
  | { type: "cancel-run"; runId: string }
  | { type: "shutdown" }
  | { type: "steer-run"; runId: string; correlationId: string; message: AgentMessage }
  | { type: "rpc-response"; rpcId: string; response: { ok: true; result: unknown } | { ok: false; error: string } };

export type ChildMessage =
  | { type: "run-log"; runId: string; stream: "stdout" | "stderr"; chunk: string }
  | { type: "run-status"; runId: string; status: RunStatus; message: string }
  | {
      type: "run-finished";
      runId: string;
      status: RunStatus;
      summary: string | null;
      errorMessage: string | null;
      exitCode: number | null;
      signal: string | null;
      model: string | null;
      usageStatus: RunUsageStatus;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | {
      type: "agent-event";
      runId: string;
      agentId: string;
      companyId: string;
      taskId: string | null;
      emittedAt: string;
      event: { type: string } & Record<string, unknown>;
    }
  | {
      type: "context-compaction";
      runId: string;
      emittedAt: string;
      estimatedTokens: number;
      originalMessageCount: number;
      compactedMessageCount: number;
      compactedOlderMessageCount: number;
      retainedRecentMessageCount: number;
    }
  | { type: "rpc-request"; rpcId: string; runId: string; method: string; payload: unknown }
  | { type: "run-agent-state"; runId: string; state: RunAgentLifecycleState }
  | { type: "steer-ack"; runId: string; correlationId: string; accepted: boolean };

export function buildRedactor(env: Record<string, string>): (text: string) => string {
  const sensitivePatterns: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value.length < 8) continue;
    if (["PATH", "HOME", "USER", "SHELL", "LANG", "TMPDIR", "TERM"].includes(key)) continue;
    sensitivePatterns.push(value);
  }
  if (sensitivePatterns.length === 0) return (text) => text;
  sensitivePatterns.sort((a, b) => b.length - a.length);
  return (text: string) => {
    let result = text;
    for (const pattern of sensitivePatterns) {
      if (result.includes(pattern)) {
        result = result.replaceAll(pattern, "[REDACTED]");
      }
    }
    return result;
  };
}
