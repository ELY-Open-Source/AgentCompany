import type { RunStatus } from "@shared/types";

export interface RunJob {
  runId: string;
  companyId: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  agentId: string;
  agentName: string;
  connectorId: string;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceMode: "exclusive" | "shared" | "none";
  command: string;
  model: string | null;
  thinkingEffort: string | null;
  env: Record<string, string>;
  sessionParams: Record<string, unknown> | null;
  systemPrompt: string | null;
  trigger: string | null;
  taskSessionId: string;
  executionMode: "ai_ceo" | "ai_cofounder";
}

export type ParentMessage =
  | { type: "enqueue-run"; payload: RunJob }
  | { type: "cancel-run"; runId: string }
  | { type: "shutdown" }
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
      sessionParams: Record<string, unknown> | null;
      sessionDisplayId: string | null;
      costUsd: number | null;
      unattributedCost: boolean;
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
  | { type: "rpc-request"; rpcId: string; runId: string; method: string; payload: unknown };

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

/**
 * Pushes extra env vars onto `process.env` and returns a restore function
 * that is **infallible** — each individual restore is guarded so a single
 * malformed key cannot leave a partial restore that keeps a provider
 * secret in the worker's env for the next run. Intended for short-lived
 * turn-scope env (`AGENT_COMPANY_*`, connector secrets). The worker runs
 * one agent at a time, so this is safe for the current scheduler; do not
 * convert it to concurrent run isolation — pass per-spawn env at the
 * child-process level instead.
 */
export function applyEnvOverrides(overrides: Record<string, string>): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  return () => {
    for (const [key, previous] of Object.entries(saved)) {
      try {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      } catch {
        // Individual restore failure is never fatal — move on so the
        // remaining keys still revert. Should never happen in practice
        // (the Node env-var assignment is synchronous and infallible for
        // string values), but the guard lets the outer finally complete.
      }
    }
  };
}
