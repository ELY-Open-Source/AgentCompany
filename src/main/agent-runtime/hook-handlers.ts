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
import { compactMessagesIfNeeded } from "./context-compactor";

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
 * Approval + wait-state gate for destructive tools. Runs at every
 * `beforeToolCall` callback, so approvals or wait states created
 * mid-run take effect on the next tool call without any cross-process
 * cache to invalidate.
 *
 * Read-only tools (read / grep / glob / list) are always allowed —
 * gating them would only slow observation while adding no safety.
 */
export function handleBeforeToolCall(
  deps: HookHandlerDeps,
  ctx: ActiveRunContext,
  payload: BeforeToolCallRpcPayload,
): BeforeToolCallRpcResult {
  if (!isDestructiveTool(payload.toolName)) {
    return { block: false, reason: null };
  }

  const approvalBlock = checkApprovalBlock(deps, ctx, payload.toolName);
  if (approvalBlock) return approvalBlock;

  const waitStateBlock = checkWaitStateBlock(deps, ctx, payload.toolName);
  if (waitStateBlock) return waitStateBlock;

  return { block: false, reason: null };
}

function checkApprovalBlock(
  deps: HookHandlerDeps,
  ctx: ActiveRunContext,
  toolName: string,
): BeforeToolCallRpcResult | null {
  try {
    const blocking = deps.db.getBlockingApproval(ctx.companyId, ctx.agentId, ctx.taskId);
    if (!blocking) return null;
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

function checkWaitStateBlock(
  deps: HookHandlerDeps,
  ctx: ActiveRunContext,
  toolName: string,
): BeforeToolCallRpcResult | null {
  try {
    if (!deps.db.hasUnresolvedWaitStateForAgent(ctx.companyId, ctx.agentId)) return null;
    return {
      block: true,
      reason: `Thread wait state is open for this agent — ${toolName} is paused until the user replies or the review resolves.`,
    };
  } catch (error) {
    deps.logger.warn(
      `[hook-handlers] wait-state lookup failed for agent ${ctx.agentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
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
