/**
 * Main-side implementations of pi's tool-execution hooks. Invoked by
 * `RuntimeBridge.handleRpc` when the worker proxies `beforeToolCall`,
 * `afterToolCall`, or `transformContext`.
 *
 * Each handler is deliberately isolated to one concern:
 *  - `beforeToolCall`: approval-gate policy (blocks destructive tools
 *    while an approval or wait state is outstanding)
 *  - `afterToolCall`: filesystem artifact projection (bash/write/edit
 *    outputs become `work_products`)
 *  - `transformContext`: auto-compaction hook (pruning in future; today
 *    passes through)
 *
 * Keeping them in this module pulls policy out of `RuntimeBridge`
 * (which stays a pure IPC router) and keeps the per-file budget under
 * the project's 500-line cap even as policy grows.
 */

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

export interface ActiveRunContext {
  runId: string;
  agentId: string;
  companyId: string;
  taskId: string | null;
  connectorId: string;
  modelId: string;
  taskSessionId: string;
  workspacePath: string | null;
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
 * Approval gate. A pending approval for this agent's current task
 * blocks every destructive tool — the agent must wait for the board
 * (or user) to resolve the approval before mutating anything.
 */
export function handleBeforeToolCall(
  deps: HookHandlerDeps,
  ctx: ActiveRunContext,
  payload: BeforeToolCallRpcPayload,
): BeforeToolCallRpcResult {
  if (!isDestructiveTool(payload.toolName)) {
    return { block: false, reason: null };
  }

  const blocking = deps.db.getBlockingApproval(ctx.companyId, ctx.agentId, ctx.taskId);
  if (blocking) {
    return {
      block: true,
      reason: `Approval ${blocking.id} (${blocking.state}) is outstanding: ${blocking.payloadSummary}. Wait for the board to decide before retrying ${payload.toolName}.`,
    };
  }

  return { block: false, reason: null };
}

/**
 * Post-execution projection. Today only filesystem artifacts flow
 * through this hook; as further projections (browser actions, social
 * posts) migrate off the event-observer path they plug in here.
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
    workspacePath: ctx.workspacePath,
  };
  try {
    projectToolExecutionToWorkProduct(
      deps.db,
      runCtx,
      {
        toolName: payload.toolName,
        args: payload.args,
        result: payload.resultContent,
        isError: payload.isError,
      },
    );
  } catch (error) {
    deps.logger.warn(
      `[hook-handlers] artifact projection failed for run ${ctx.runId} tool ${payload.toolName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return NO_OP_AFTER;
}

/**
 * Context-transform hook. Placeholder pass-through; auto-compaction
 * wiring lives in session-management-service and plugs in here once
 * the compactor is available (tracked separately from the contract
 * wiring).
 */
export function handleTransformContext(
  _deps: HookHandlerDeps,
  _ctx: ActiveRunContext,
  _payload: TransformContextRpcPayload,
): TransformContextRpcResult {
  return { changed: false, messages: null };
}
