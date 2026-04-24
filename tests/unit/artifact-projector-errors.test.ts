import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "../../src/main/database";
import {
  captureBaselineIfRequired,
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

  it("skips completion reconciliation when the run has no change source", async () => {
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

    expect(reconcileWorkspaceArtifacts({} as AppDatabase, ctx)).toEqual([
      { kind: "skipped", reason: "no_baseline" },
    ]);
  });
});
