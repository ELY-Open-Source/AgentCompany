import type { AppDatabase } from "@main/database";
import { collectChangedPaths } from "./artifact-change-detector";
import {
  projectChangedPaths,
  projectSinglePathArtifact,
  retireDeletedArtifacts,
} from "./artifact-work-products";
import type {
  ArtifactProjectorRunContext,
  ArtifactProjectorToolEvent,
  ChangeSet,
  ProjectionOutcome,
} from "./artifact-types";

export { captureBaselineIfRequired } from "./artifact-baseline";
export type {
  ArtifactProjectorRunContext,
  ArtifactProjectorToolEvent,
  ProjectionOutcome,
  WorkspaceBaseline,
} from "./artifact-types";

/**
 * Filesystem artifact protocol for pi tool invocations.
 *
 * Successful destructive tool calls (`write`, `edit`, `bash`) are
 * projected into `work_products`, so the desktop UI can surface what
 * the agent produced without relying on the agent to POST documents.
 *
 * Projection is idempotent through the natural identity
 * `(companyId, workspaceId, provider="filesystem", externalId=<workspace-relative-path>)`.
 * Git workspaces use `git status`; non-git workspaces use a run-start
 * mtime baseline captured by `captureBaselineIfRequired`.
 */

type WriteArgs = { path: unknown; content?: unknown };
type EditArgs = { path: unknown };

/** Normalises pi tool-call args to the file path the agent touched. */
function extractToolPath(toolName: string, args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  if (toolName === "write") {
    const p = (args as WriteArgs).path;
    return typeof p === "string" && p.length > 0 ? p : null;
  }
  if (toolName === "edit") {
    const p = (args as EditArgs).path;
    return typeof p === "string" && p.length > 0 ? p : null;
  }
  return null;
}

/**
 * Upsert work_products rows for a successful destructive tool call.
 * `write` / `edit` use their explicit path; `bash` scans the workspace
 * change set through git status or the captured baseline.
 */
export function projectToolExecutionToWorkProduct(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  event: ArtifactProjectorToolEvent,
): ProjectionOutcome[] {
  if (event.isError) return [{ kind: "skipped", reason: "tool_error" }];
  if (!ctx.workspacePath) return [{ kind: "skipped", reason: "no_workspace" }];

  if (event.toolName === "write" || event.toolName === "edit") {
    return [projectSinglePathArtifact(db, ctx, extractToolPath(event.toolName, event.args))];
  }
  if (event.toolName === "bash") {
    return projectBashArtifacts(db, ctx);
  }
  return [{ kind: "skipped", reason: "unsupported_tool" }];
}

/**
 * End-of-run reconciliation sweep. The per-tool `afterToolCall` hook
 * registers artifacts eagerly; the sweep catches files missed by a
 * transient hook failure or a bash invocation that touched many paths.
 */
export function reconcileWorkspaceArtifacts(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
): ProjectionOutcome[] {
  if (ctx.workspaceMode !== "exclusive") {
    return [{ kind: "skipped", reason: "workspace_not_exclusive" }];
  }
  return projectCollectedChanges(db, ctx, collectChangedPaths(ctx));
}

function projectBashArtifacts(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
): ProjectionOutcome[] {
  if (ctx.workspaceMode !== "exclusive") {
    return [{ kind: "skipped", reason: "workspace_not_exclusive" }];
  }
  return projectCollectedChanges(db, ctx, collectChangedPaths(ctx));
}

function projectCollectedChanges(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  change: ChangeSet,
): ProjectionOutcome[] {
  if (change.source === "none") {
    return [{ kind: "skipped", reason: change.skipReason ?? "no_changes" }];
  }
  const outcomes: ProjectionOutcome[] = [];
  if (change.changed.length === 0 && change.deleted.length === 0) {
    outcomes.push({ kind: "skipped", reason: "no_changes" });
  } else {
    outcomes.push(...projectChangedPaths(db, ctx, change.changed));
    outcomes.push(...retireDeletedArtifacts(db, ctx, change.deleted));
  }
  if (change.coverageTruncated) {
    outcomes.push({ kind: "skipped", reason: "baseline_truncated" });
  }
  return outcomes;
}
