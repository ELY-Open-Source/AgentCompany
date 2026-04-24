/**
 * Main-side implementations of pi's tool-execution hooks. Invoked by
 * `RuntimeBridge.handleRpc` when the worker proxies `beforeToolCall`
 * or `afterToolCall`.
 *
 * Each handler is deliberately isolated to one concern:
 *  - `beforeToolCall`: operational-approval gate (blocks destructive
 *    tools only while an approval that gates EXECUTION is pending)
 *  - `afterToolCall`: filesystem artifact projection (bash/write/edit
 *    outputs become `work_products`)
 *
 * Policy lives here; `RuntimeBridge` stays a pure IPC router.
 */

import type { AppDatabase } from "@main/database";
import type {
  AfterToolCallRpcPayload,
  AfterToolCallRpcResult,
  BeforeToolCallRpcPayload,
  BeforeToolCallRpcResult,
} from "./hook-rpc";
import {
  projectToolExecutionToWorkProduct,
  type ArtifactProjectorRunContext,
} from "./artifact-projector";
import {
  appendArtifactProjectionEvent,
  appendArtifactProjectionFailureEvent,
} from "./artifact-projection-events";
import {
  isCofounderMandatoryApproval,
  isOperationalApproval,
} from "../execution-policy";

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
    const companyMode = deps.db.core.company.getCompanyExecutionMode(ctx.companyId);
    const cofounderCheckpointBlocks =
      companyMode === "ai_cofounder" && isCofounderMandatoryApproval(blocking.type);
    if (!isOperationalApproval(blocking.type) && !cofounderCheckpointBlocks) {
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
 * Projection is treated as a primary persistence action: the filesystem
 * mutation and its run-event acknowledgement commit together. A failure
 * returns an RPC error to the worker, which lets pi surface the hook
 * failure as a deterministic tool error.
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
    workspaceMode: ctx.workspaceMode,
    logger: deps.logger,
    workspaceBaseline: ctx.workspaceBaseline,
  };
  try {
    const outcomes = deps.db.withTransaction(() => {
      const projectionOutcomes = projectToolExecutionToWorkProduct(
        deps.db,
        runCtx,
        {
          toolName: payload.toolName,
          args: payload.args,
          result: payload.resultContent,
          isError: payload.isError,
        },
      );
      appendArtifactProjectionEvent(deps.db, {
        companyId: ctx.companyId,
        runId: ctx.runId,
        agentId: ctx.agentId,
        phase: "after_tool_call",
        workspaceId: ctx.workspaceId,
        workspaceMode: ctx.workspaceMode,
        toolName: payload.toolName,
        toolCallId: payload.toolCallId,
        outcomes: projectionOutcomes,
      });
      return projectionOutcomes;
    });
    const registered = outcomes.filter((o) => o.kind === "inserted" || o.kind === "updated").length;
    const retired = outcomes.filter((o) => o.kind === "retired").length;
    if (registered > 0 || retired > 0) {
      deps.logger.info(
        `[hook-handlers] projection for run ${ctx.runId} via ${payload.toolName}: ${registered} registered, ${retired} retired`,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      appendArtifactProjectionFailureEvent(deps.db, {
        companyId: ctx.companyId,
        runId: ctx.runId,
        agentId: ctx.agentId,
        phase: "after_tool_call",
        workspaceId: ctx.workspaceId,
        workspaceMode: ctx.workspaceMode,
        toolName: payload.toolName,
        toolCallId: payload.toolCallId,
        errorMessage,
      });
    } catch (ackError) {
      deps.logger.error(
        `[hook-handlers] artifact projection failure ack failed for run ${ctx.runId} tool ${payload.toolName}: ${ackError instanceof Error ? ackError.message : String(ackError)}`,
      );
    }
    deps.logger.error(
      `[hook-handlers] artifact projection threw for run ${ctx.runId} tool ${payload.toolName}: ${errorMessage}`,
    );
    throw error;
  }
  return NO_OP_AFTER;
}
