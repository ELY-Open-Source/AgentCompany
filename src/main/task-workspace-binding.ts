import type { AppDatabase } from "./database";

type WorkspaceBindingSource =
  | "explicit"
  | "project"
  | "assignee"
  | "run"
  | "creator"
  | "single_company"
  | "none";

export type TaskWorkspaceBindingResult =
  | { ok: true; workspaceId: string | null; source: WorkspaceBindingSource }
  | { ok: false; error: string };

export interface TaskWorkspaceBindingInput {
  companyId: string;
  requiresFilesystem: boolean;
  explicitWorkspaceId?: string | null;
  projectId?: string | null;
  assigneeAgentId?: string | null;
  creatorAgentId?: string | null;
  currentRunId?: string | null;
}

export function resolveTaskWorkspaceBinding(
  db: AppDatabase,
  input: TaskWorkspaceBindingInput,
): TaskWorkspaceBindingResult {
  if (input.explicitWorkspaceId) {
    const explicit = getCompanyWorkspace(db, input.companyId, input.explicitWorkspaceId);
    if (!explicit) {
      return { ok: false, error: "Selected workspace does not belong to this company." };
    }
    return { ok: true, workspaceId: explicit.id, source: "explicit" };
  }

  if (!input.requiresFilesystem) {
    return {
      ok: true,
      workspaceId: null,
      source: "none",
    };
  }

  const project = db.core.workspaces.getProjectPrimaryWorkspace(input.projectId ?? null, input.companyId);
  if (project) return { ok: true, workspaceId: project.id, source: "project" };

  const assignee = getAgentWorkspace(db, input.companyId, input.assigneeAgentId ?? null);
  if (assignee) return { ok: true, workspaceId: assignee.id, source: "assignee" };

  const run = getRunWorkspace(db, input.companyId, input.currentRunId ?? null);
  if (run) return { ok: true, workspaceId: run.id, source: "run" };

  const creator = getAgentWorkspace(db, input.companyId, input.creatorAgentId ?? null);
  if (creator) return { ok: true, workspaceId: creator.id, source: "creator" };

  const singleCompanyWorkspace = getSingleCompanyWorkspace(db, input.companyId);
  if (singleCompanyWorkspace) {
    return { ok: true, workspaceId: singleCompanyWorkspace.id, source: "single_company" };
  }

  return {
    ok: false,
    error: "Filesystem tasks require a workspace. Provide workspaceId, bind the project to a workspace, or bind the assignee/creator agent to a workspace.",
  };
}

function getCompanyWorkspace(db: AppDatabase, companyId: string, workspaceId: string | null): { id: string } | null {
  if (!workspaceId) return null;
  const workspace = db.core.workspaces.getWorkspace(workspaceId);
  return workspace && workspace.companyId === companyId ? workspace : null;
}

function getAgentWorkspace(db: AppDatabase, companyId: string, agentId: string | null): { id: string } | null {
  if (!agentId) return null;
  try {
    const agent = db.core.entity.getAgent(agentId);
    if (agent.companyId !== companyId) return null;
    return getCompanyWorkspace(db, companyId, agent.workspaceId);
  } catch {
    return null;
  }
}

function getRunWorkspace(db: AppDatabase, companyId: string, runId: string | null): { id: string } | null {
  if (!runId) return null;
  try {
    const run = db.core.runs.getRun(runId);
    if (run.companyId !== companyId) return null;
    return getCompanyWorkspace(db, companyId, run.workspaceId);
  } catch {
    return null;
  }
}

function getSingleCompanyWorkspace(db: AppDatabase, companyId: string): { id: string } | null {
  const workspaces = db.projection.snapshot
    .listSnapshot({ companyId })
    .workspaces
    .filter((workspace) => workspace.companyId === companyId);
  return workspaces.length === 1 ? workspaces[0]! : null;
}
