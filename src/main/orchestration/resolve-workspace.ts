import type { AppDatabase } from "../database";
import type { WorkspaceLockMode } from "./types";

/**
 * Resolve the workspace and lock semantics for a given run context.
 *
 * Previously this logic lived both in run-dispatch.ts (normal dispatch path)
 * and worker-crash-recovery.ts (re-enqueue after crash); the recovery
 * copy silently dropped the exclusive/shared distinction. Sharing the
 * helper guarantees both paths agree on which runs hold exclusive locks.
 */
export function resolveWorkspaceWithLockMode(
  db: AppDatabase,
  task: { workspaceId: string | null; projectId?: string | null },
  agent: { workspaceId: string | null },
  companyId: string,
): {
  workspace: ReturnType<AppDatabase["getWorkspace"]>;
  lockMode: WorkspaceLockMode;
  source: "task" | "agent" | "project" | "company_fallback" | "none";
} {
  const taskWorkspace = db.getWorkspace(task.workspaceId);
  if (taskWorkspace) {
    return { workspace: taskWorkspace, lockMode: "exclusive", source: "task" };
  }

  const agentWorkspace = db.getWorkspace(agent.workspaceId);
  if (agentWorkspace) {
    return { workspace: agentWorkspace, lockMode: "exclusive", source: "agent" };
  }

  const projectWorkspace = db.getProjectPrimaryWorkspace(task.projectId ?? null, companyId);
  if (projectWorkspace) {
    return { workspace: projectWorkspace, lockMode: "exclusive", source: "project" };
  }

  const fallbackWorkspace = db.getAnyCompanyWorkspace(companyId);
  if (fallbackWorkspace) {
    return { workspace: fallbackWorkspace, lockMode: "shared", source: "company_fallback" };
  }

  return { workspace: null, lockMode: "none", source: "none" };
}
