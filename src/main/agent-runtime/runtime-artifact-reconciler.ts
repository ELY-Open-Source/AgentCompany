import type { AppDatabase } from "@main/database";
import type { ActiveRunContext } from "./hook-handlers";
import { reconcileWorkspaceArtifacts } from "./artifact-projector";
import {
  appendArtifactProjectionEvent,
  appendArtifactProjectionFailureEvent,
} from "./artifact-projection-events";

export type RunResourceReleaseResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

export interface RuntimeArtifactReconcilerDeps {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export function reconcileArtifactsForActiveRun(
  deps: RuntimeArtifactReconcilerDeps,
  ctx: ActiveRunContext,
): RunResourceReleaseResult {
  try {
    const outcomes = deps.db.withTransaction(() => {
      const projectionOutcomes = reconcileWorkspaceArtifacts(deps.db, {
        runId: ctx.runId,
        agentId: ctx.agentId,
        companyId: ctx.companyId,
        taskId: ctx.taskId,
        workspaceId: ctx.workspaceId,
        workspacePath: ctx.workspacePath,
        workspaceMode: ctx.workspaceMode,
        logger: deps.logger,
        workspaceBaseline: ctx.workspaceBaseline,
      });
      appendArtifactProjectionEvent(deps.db, {
        companyId: ctx.companyId,
        runId: ctx.runId,
        agentId: ctx.agentId,
        phase: "completion_reconcile",
        workspaceId: ctx.workspaceId,
        workspaceMode: ctx.workspaceMode,
        outcomes: projectionOutcomes,
      });
      return projectionOutcomes;
    });
    const inserted = outcomes.filter((o) => o.kind === "inserted").length;
    const retired = outcomes.filter((o) => o.kind === "retired").length;
    if (inserted > 0 || retired > 0) {
      deps.logger.info(
        `[runtime-bridge] reconciliation for run ${ctx.runId}: ${inserted} registered, ${retired} retired`,
      );
    }
    return { ok: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      appendArtifactProjectionFailureEvent(deps.db, {
        companyId: ctx.companyId,
        runId: ctx.runId,
        agentId: ctx.agentId,
        phase: "completion_reconcile",
        workspaceId: ctx.workspaceId,
        workspaceMode: ctx.workspaceMode,
        errorMessage,
      });
    } catch (ackError) {
      deps.logger.error(
        `[runtime-bridge] artifact reconciliation failure ack failed for run ${ctx.runId}: ${ackError instanceof Error ? ackError.message : String(ackError)}`,
      );
    }
    deps.logger.error(
      `[runtime-bridge] artifact reconciliation failed for run ${ctx.runId}: ${errorMessage}`,
    );
    return { ok: false, errorMessage };
  }
}
