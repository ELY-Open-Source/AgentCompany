import type { AppDatabase } from "../database";
import type { WorkspaceLockMode } from "./types";

/**
 * Resolve the workspace and lock semantics for a run context.
 *
 * Lock policy: every resolved workspace is held exclusively for the
 * duration of the run. Pi's `createCodingTools()` hands every agent
 * the mutating `bash`, `write`, and `edit` tools, so there is no
 * read-only category where concurrent runs are safe — two agents
 * editing the same working tree step on each other's files and
 * corrupt git state before the per-repo `index.lock` even gets
 * touched.
 *
 * Contention is handled at dispatch time: `run-dispatch.ts` tries
 * `claimWorkspaceLock` synchronously. A lost race finishes the run
 * as `cancelled` (not `failed` — the Dashboard's "Needs attention"
 * card ignores cancellations), and the next heartbeat retries on
 * its own cadence. The caller must keep that rollback path alive;
 * without it contention would leave tasks pinned at `in_progress`
 * forever.
 *
 * When no workspace can be resolved (headless heartbeat runs that
 * have no repo to touch) we return `none`; the worker uses
 * `process.cwd()` as a read-only cwd and the dispatcher skips the
 * lock claim.
 */
export function resolveWorkspaceWithLockMode(
  db: AppDatabase,
  task: { workspaceId: string | null; projectId?: string | null } | null,
  agent: { workspaceId: string | null },
  companyId: string,
): {
  workspace: ReturnType<AppDatabase["getWorkspace"]>;
  lockMode: WorkspaceLockMode;
  source: "task" | "agent" | "project" | "company_fallback" | "none";
} {
  if (task) {
    const taskWorkspace = db.getWorkspace(task.workspaceId);
    if (taskWorkspace) {
      return { workspace: taskWorkspace, lockMode: "exclusive", source: "task" };
    }
  }

  const agentWorkspace = db.getWorkspace(agent.workspaceId);
  if (agentWorkspace) {
    return { workspace: agentWorkspace, lockMode: "exclusive", source: "agent" };
  }

  const projectWorkspace = db.getProjectPrimaryWorkspace(task?.projectId ?? null, companyId);
  if (projectWorkspace) {
    return { workspace: projectWorkspace, lockMode: "exclusive", source: "project" };
  }

  const fallbackWorkspace = db.getAnyCompanyWorkspace(companyId);
  if (fallbackWorkspace) {
    return { workspace: fallbackWorkspace, lockMode: "exclusive", source: "company_fallback" };
  }

  return { workspace: null, lockMode: "none", source: "none" };
}
