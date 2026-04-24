import { statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { AppDatabase } from "@main/database";
import { logArtifactFsError } from "./artifact-logging";
import { isRegistrablePath } from "./artifact-path-filter";
import type { ArtifactProjectorRunContext, ProjectionOutcome } from "./artifact-types";

const MAX_BASH_PROJECTED_FILES = 50;

export function projectSinglePathArtifact(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  rawPath: string | null,
): ProjectionOutcome {
  if (!ctx.workspacePath) return { kind: "skipped", reason: "no_workspace" };
  if (!rawPath) return { kind: "skipped", reason: "missing_path" };

  const absPath = isAbsolute(rawPath) ? rawPath : resolve(ctx.workspacePath, rawPath);
  if (!isRegistrablePath(absPath, ctx.workspacePath)) {
    return { kind: "skipped", reason: "path_ignored" };
  }
  return upsertFilesystemArtifact(db, ctx, ctx.workspacePath, absPath);
}

export function projectChangedPaths(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  changed: string[],
): ProjectionOutcome[] {
  const workspacePath = ctx.workspacePath;
  if (!workspacePath) return [{ kind: "skipped", reason: "no_workspace" }];
  const outcomes: ProjectionOutcome[] = [];
  const budget = changed.slice(0, MAX_BASH_PROJECTED_FILES);
  for (const rel of budget) {
    const absPath = resolve(workspacePath, rel);
    if (!isRegistrablePath(absPath, workspacePath)) {
      outcomes.push({ kind: "skipped", reason: "path_ignored" });
      continue;
    }
    outcomes.push(upsertFilesystemArtifact(db, ctx, workspacePath, absPath));
  }
  if (changed.length > MAX_BASH_PROJECTED_FILES) {
    outcomes.push({ kind: "skipped", reason: "bash_scan_cap_exceeded" });
  }
  return outcomes;
}

export function retireDeletedArtifacts(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  deleted: string[],
): ProjectionOutcome[] {
  if (deleted.length === 0) return [];
  const resolvedWorkspaceId =
    ctx.workspaceId ??
    (ctx.workspacePath
      ? db.core.workspaces.findWorkspaceIdByLocalPath(ctx.companyId, ctx.workspacePath)
      : null);
  const archived = db.core.documents.archiveWorkProductsByExternalPaths({
    companyId: ctx.companyId,
    workspaceId: resolvedWorkspaceId,
    provider: "filesystem",
    paths: deleted,
    lastTouchedByRunId: ctx.runId,
  });
  return archived.map(({ id, externalId }) => ({
    kind: "retired",
    workProductId: id,
    relativePath: externalId,
  }));
}

function upsertFilesystemArtifact(
  db: AppDatabase,
  ctx: ArtifactProjectorRunContext,
  workspacePath: string,
  absPath: string,
): ProjectionOutcome {
  const relativePath = relative(workspacePath, absPath);
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(absPath);
  } catch (error) {
    logArtifactFsError(
      ctx.logger,
      error,
      "artifact.fs.path_stat_failed",
      "Failed to stat filesystem artifact before projection.",
      {
        workspacePath,
        absPath,
        runId: ctx.runId,
      },
    );
    return { kind: "skipped", reason: "path_missing" };
  }
  if (!stat.isFile()) {
    return { kind: "skipped", reason: "not_a_regular_file" };
  }

  const lastSlash = relativePath.lastIndexOf("/");
  const title = lastSlash >= 0 ? relativePath.slice(lastSlash + 1) : relativePath;
  const provider = "filesystem";
  const resolvedWorkspaceId =
    ctx.workspaceId ?? db.core.workspaces.findWorkspaceIdByLocalPath(ctx.companyId, workspacePath);
  const existing = db.core.documents.findWorkProductByExternalId(
    ctx.companyId,
    provider,
    relativePath,
    resolvedWorkspaceId,
  );
  if (existing) {
    const patch: Parameters<typeof db.core.documents.updateWorkProduct>[2] = {
      title,
      status: "active",
      lastTouchedByRunId: ctx.runId,
    };
    if (resolvedWorkspaceId) patch.workspaceId = resolvedWorkspaceId;
    db.core.documents.updateWorkProduct(existing.id, ctx.companyId, patch);
    return { kind: "updated", workProductId: existing.id, relativePath };
  }
  const workProductId = db.core.documents.createWorkProduct({
    companyId: ctx.companyId,
    taskId: ctx.taskId,
    workspaceId: resolvedWorkspaceId,
    type: "file",
    provider,
    externalId: relativePath,
    title,
    url: null,
    createdByRunId: ctx.runId,
  });
  return { kind: "inserted", workProductId, relativePath };
}
