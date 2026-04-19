/**
 * Main-side implementations of pi's tool-execution hooks. Invoked by
 * `RuntimeBridge.handleRpc` when the worker proxies `beforeToolCall`,
 * `afterToolCall`, or `transformContext`.
 *
 * Each handler is deliberately isolated to one concern:
 *  - `beforeToolCall`: operational-approval gate (blocks destructive
 *    tools only while an approval that gates EXECUTION is pending)
 *  - `afterToolCall`: filesystem artifact projection (bash/write/edit
 *    outputs become `work_products`)
 *  - `transformContext`: per-LLM-call auto-compaction via a pure
 *    reducer
 *
 * Policy lives here; `RuntimeBridge` stays a pure IPC router.
 */

import type { ApprovalType } from "@shared/types";
import type { AppDatabase } from "@main/database";
import type {
  AfterToolCallRpcPayload,
  AfterToolCallRpcResult,
  BeforeToolCallRpcPayload,
  BeforeToolCallRpcResult,
  TransformContextRpcPayload,
  TransformContextRpcResult,
} from "./hook-rpc";
import {
  projectToolExecutionToWorkProduct,
  type ArtifactProjectorRunContext,
} from "./artifact-projector";
import { compactMessagesIfNeeded } from "./context-compactor";

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

const NO_OP_AFTER: AfterToolCallRpcResult = {
  contentOverride: null,
  isErrorOverride: null,
};

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
 * Approval types that gate EXECUTION (not decision). These stop the
 * destructive toolchain until the board releases the hold.
 *
 * Decision-type approvals (deliverable_review, plan_review, hire_agent,
 * …) are deliberately excluded: they mean "a human owes an answer
 * about completed or proposed work". The agent is still free to reply
 * to messages, coordinate with peers, or work on unrelated tasks
 * while the decision is pending — blocking their tools there turns
 * the board-review pattern into a company-wide freeze.
 */
const OPERATIONAL_APPROVAL_TYPES: ReadonlySet<ApprovalType> = new Set<ApprovalType>([
  "dangerous_command",
  "secret_access",
  "production_deploy",
  "social_post",
  "budget_override",
]);

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
    const blocking = deps.db.getBlockingApproval(ctx.companyId, ctx.agentId, ctx.taskId);
    if (!blocking) return { block: false, reason: null };
    if (!OPERATIONAL_APPROVAL_TYPES.has(blocking.type as ApprovalType)) {
      return { block: false, reason: null };
    }
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

/**
 * Post-execution projection. Today only filesystem artifacts flow
 * through this hook; as further projections (browser actions, social
 * posts) migrate off the event-observer path they plug in here.
 *
 * Projection is treated as a primary persistence action: failures are
 * logged at ERROR so they stay visible in the desktop log tail, and the
 * `run-finished` reconciliation sweep (`RuntimeBridge`) revisits the
 * workspace to register anything the hook missed. Silent swallow was
 * the failure mode that left `work_products` empty while the workspace
 * accumulated files the UI never surfaced.
 */
export function handleAfterToolCall(
  deps: HookHandlerDeps,
  ctx: ActiveRunContext,
  payload: AfterToolCallRpcPayload,
): AfterToolCallRpcResult {
  const runCtx: ArtifactProjectorRunContext = {
    runId: ctx.runId,
    agentId: ctx.agentId,
    companyId: ctx.companyId,
    taskId: ctx.taskId,
    workspaceId: ctx.workspaceId,
    workspacePath: ctx.workspacePath,
    workspaceBaseline: ctx.workspaceBaseline,
  };
  try {
    const outcomes = projectToolExecutionToWorkProduct(
      deps.db,
      runCtx,
      {
        toolName: payload.toolName,
        args: payload.args,
        result: payload.resultContent,
        isError: payload.isError,
      },
    );
    const registered = outcomes.filter((o) => o.kind === "inserted" || o.kind === "updated").length;
    const retired = outcomes.filter((o) => o.kind === "retired").length;
    if (registered > 0 || retired > 0) {
      deps.logger.info(
        `[hook-handlers] projection for run ${ctx.runId} via ${payload.toolName}: ${registered} registered, ${retired} retired`,
      );
    }
  } catch (error) {
    deps.logger.error(
      `[hook-handlers] artifact projection threw for run ${ctx.runId} tool ${payload.toolName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return NO_OP_AFTER;
}

/**
 * Context-transform hook. Delegates to `compactMessagesIfNeeded`,
 * which is a pure, provider-free deterministic compactor. Runs before
 * every LLM call; short transcripts short-circuit on the token-budget
 * check so the steady-state cost is negligible.
 */
export function handleTransformContext(
  _deps: HookHandlerDeps,
  _ctx: ActiveRunContext,
  payload: TransformContextRpcPayload,
): TransformContextRpcResult {
  const outcome = compactMessagesIfNeeded(payload.messages);
  return { changed: outcome.changed, messages: outcome.messages };
}
