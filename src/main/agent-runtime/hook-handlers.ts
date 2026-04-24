/**
 * Main-side implementation of pi's tool-execution approval hook.
 * Invoked by `RuntimeBridge.handleRpc` when the worker proxies
 * `beforeToolCall`.
 *
 * The handler is deliberately isolated to the operational-approval
 * gate: it blocks destructive tools while an approval that gates
 * EXECUTION is pending.
 *
 * Policy lives here; `RuntimeBridge` stays a pure IPC router.
 */

import type { AppDatabase } from "@main/database";
import type {
  BeforeToolCallRpcPayload,
  BeforeToolCallRpcResult,
} from "./hook-rpc";

/**
 * Lifecycle phase of an active pi run as seen by main.
 *
 *  - `preparing`: `prepareRun` RPC has landed; main knows the run is real,
 *    but the worker has not yet constructed the Agent instance. The
 *    in-process `activeAgents` map is empty, so any `steer` attempt would
 *    be silently dropped.
 *  - `agent_active`: the worker has both constructed the Agent and
 *    subscribed to its event stream. Steer-run messages are safe to
 *    dispatch — `agent.steer()` will enqueue onto the live steering queue
 *    and pi will drain it at the next turn boundary.
 *  - `closing`: the Agent finished (or aborted) and the worker has
 *    unsubscribed and removed the instance from `activeAgents`. The
 *    `run-finished` child message may still be in flight; treat steer
 *    messages as rejected so inbox delivery falls back to the next run.
 */
export type ActiveRunLifecycleState = "preparing" | "agent_active" | "closing";

export interface ActiveRunContext {
  runId: string;
  agentId: string;
  companyId: string;
  taskId: string | null;
  connectorId: string;
  modelId: string;
  taskSessionId: string;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceMode: "exclusive" | "shared" | "none";
  workspaceBaseline: import("./artifact-projector").WorkspaceBaseline | null;
  state: ActiveRunLifecycleState;
}

export interface HookHandlerDeps {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Tools that can mutate the workspace or execute host-level effects.
 * Every other tool (read/grep/glob) is always permitted — gating them
 * would only slow observation.
 */
const DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set(["bash", "write", "edit"]);

export function isDestructiveTool(toolName: string): boolean {
  return DESTRUCTIVE_TOOLS.has(toolName);
}

/**
 * Approval gate for destructive tools. Runs at every
 * `beforeToolCall`, so approvals created mid-run take effect on the
 * next tool call with no cross-process cache to invalidate.
 *
 * Heartbeat-level wait-state pausing is the responsibility of the
 * scheduler (`checkpoint-engine.shouldPauseHeartbeat`); mirroring it
 * here would freeze every outbound message and every coordination
 * reply while an unrelated thread was still waiting on the user —
 * the exact failure mode that made Co-Founder agents silent.
 */
export function handleBeforeToolCall(
  deps: HookHandlerDeps,
  ctx: ActiveRunContext,
  payload: BeforeToolCallRpcPayload,
): BeforeToolCallRpcResult {
  if (!isDestructiveTool(payload.toolName)) {
    return { block: false, reason: null };
  }
  return checkOperationalApprovalBlock(deps, ctx, payload.toolName);
}

function checkOperationalApprovalBlock(
  deps: HookHandlerDeps,
  ctx: ActiveRunContext,
  toolName: string,
): BeforeToolCallRpcResult {
  try {
    const blocking = deps.db.core.approvals.getBlockingApproval(ctx.companyId, ctx.agentId, ctx.taskId);
    if (!blocking) return { block: false, reason: null };
    return {
      block: true,
      reason: `Approval ${blocking.id} (${blocking.type}, state=${blocking.state}) is outstanding: ${blocking.payloadSummary}. Wait for the decision before retrying ${toolName}.`,
    };
  } catch (error) {
    // Fail closed: an unreadable approval table is a safety incident,
    // not a reason to run destructive code.
    deps.logger.error(
      `[hook-handlers] approval lookup failed for agent ${ctx.agentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      block: true,
      reason: `Approval lookup failed — ${toolName} is held until the approval subsystem recovers.`,
    };
  }
}
