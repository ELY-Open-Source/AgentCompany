import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "../../src/main/database";
import {
  captureBaselineIfRequired,
  projectToolExecutionToWorkProduct,
  reconcileWorkspaceArtifacts,
  type ArtifactProjectorRunContext,
} from "../../src/main/agent-runtime/artifact-projector";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("artifact projector error taxonomy", () => {
  it("classifies unreadable workspace baseline capture failures", async () => {
    const logger = createLogger();
    const parent = await createTempDir("agentcompany-missing-workspace-parent-");
    const workspacePath = join(parent, "missing-workspace");

    const baseline = captureBaselineIfRequired(workspacePath, logger);

    expect(baseline).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "[artifact.fs.workspace_stat_failed] Failed to stat workspace before artifact baseline capture.",
      { workspacePath },
      expect.stringContaining("cause="),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("classifies missing filesystem artifact projection failures", async () => {
    const logger = createLogger();
    const workspacePath = await createTempDir("agentcompany-artifact-errors-");
    const absPath = join(workspacePath, "missing.md");
    const ctx: ArtifactProjectorRunContext = {
      runId: "run-artifact-error",
      agentId: "agent-artifact-error",
      companyId: "company-artifact-error",
      taskId: "task-artifact-error",
      workspaceId: "workspace-artifact-error",
      workspacePath,
      workspaceMode: "exclusive",
      logger,
      workspaceBaseline: null,
    };

    const outcomes = projectToolExecutionToWorkProduct(
      {} as AppDatabase,
      ctx,
      {
        toolName: "write",
        args: { path: "missing.md" },
        result: null,
        isError: false,
      },
    );

    expect(outcomes).toEqual([{ kind: "skipped", reason: "path_missing" }]);
    expect(logger.warn).toHaveBeenCalledWith(
      "[artifact.fs.path_stat_failed] Failed to stat filesystem artifact before projection.",
      {
        workspacePath,
        absPath,
        runId: "run-artifact-error",
      },
      expect.stringContaining("cause="),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("skips broad bash projection when the run has no exclusive workspace lock", async () => {
    const workspacePath = await createTempDir("agentcompany-shared-artifacts-");
    const ctx: ArtifactProjectorRunContext = {
      runId: "run-shared",
      agentId: "agent-shared",
      companyId: "company-shared",
      taskId: "task-shared",
      workspaceId: null,
      workspacePath,
      workspaceMode: "none",
      logger: createLogger(),
      workspaceBaseline: null,
    };

    expect(projectToolExecutionToWorkProduct({} as AppDatabase, ctx, {
      toolName: "bash",
      args: { command: "touch report.md" },
      result: null,
      isError: false,
    })).toEqual([{ kind: "skipped", reason: "workspace_not_exclusive" }]);
    expect(reconcileWorkspaceArtifacts({} as AppDatabase, ctx)).toEqual([
      { kind: "skipped", reason: "workspace_not_exclusive" },
    ]);
  });
});
