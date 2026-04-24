import type { AppDatabase } from "@main/database";
import { collectChangedPaths } from "./artifact-change-detector";
import {
  projectChangedPaths,
  retireDeletedArtifacts,
} from "./artifact-work-products";
import type {
  ArtifactProjectorRunContext,
  ChangeSet,
  ProjectionOutcome,
} from "./artifact-types";

export { captureBaselineIfRequired } from "./artifact-baseline";
export type {
  ArtifactProjectorRunContext,
  ProjectionOutcome,
  WorkspaceBaseline,
} from "./artifact-types";

/**
 * End-of-run filesystem artifact protocol.
 *
 * Completion reconciliation projects changed and deleted workspace
 * paths into `work_products`, so the desktop UI can surface what the
 * agent produced without relying on the agent to POST documents.
 *
 * Projection is idempotent through the natural identity
 * `(companyId, workspaceId, provider="filesystem", externalId=<workspace-relative-path>)`.
 * Git workspaces use `git status`; non-git workspaces use a run-start
 * mtime baseline captured by `captureBaselineIfRequired`.
 */

/**
 * End-of-run reconciliation sweep. This is the single artifact
 * projection boundary for files produced or removed during a run.
 */
export function reconcileWorkspaceArtifacts(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
): ProjectionOutcome[] {
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
