import type { AppDatabase } from "../database";
import type { AgentRecord, TaskRecord, WorkspaceRecord } from "@shared/types";
import type { WorkspaceLockMode } from "./types";

/**
 * Per-task workspace lock inference (v52+).
 *
 * The core invariant is: `lockMode='exclusive'` is an *opt-in*,
 * `lockMode='none'` is the default. Previously every resolved
 * workspace was held exclusively, which folded four runnable
 * agents onto a single company workspace lock and serialised the
 * entire C-suite. The fix is to ask the task row for filesystem
 * intent.
 *
 * `inferLockMode` returns the pair of decisions the dispatcher
 * needs (mode + which workspace, if any). `resolveWorkspaceWithLockMode`
 * is the thin outward-facing wrapper that loads the actual
 * `WorkspaceRecord` for callers that need the path / companyId.
 *
 * Silent fallbacks removed in this rewrite:
 *
 *   - `company_fallback`: previously the fourth fallback step
 *     returned *any* workspace row in the company as the lock target.
 *     That was silent corruption's favourite mechanism: four agents
 *     with no workspace binding would all land on the same row and
 *     fight for one mutex. A task that needs a filesystem and has no
 *     legitimate binding now throws `ConfigurationError` at resolve
 *     time so the caller decides (skip heartbeat, surface error,
 *     whatever) instead of the resolver guessing.
 *
 *   - `lockMode='exclusive'` always returns a resolved workspace.
 *     `lockMode='none'` always returns `workspace=null`.
 *
 */

export type WorkspaceResolutionSource =
  | "task"
  | "agent"
  | "project"
  | "none";

export interface WorkspaceResolution {
  /**
   * The workspace whose lock the dispatcher will claim. Non-null iff
   * `lockMode === 'exclusive'`; the type system enforces the pair.
   */
  workspace: WorkspaceRecord | null;
  lockMode: WorkspaceLockMode;
  source: WorkspaceResolutionSource;
  /**
   * Where the artifact projector should *observe* for files this run
   * may produce, independent of the lock decision. Set whenever the
   * company has at least one workspace row, even when `lockMode='none'`
   * because cognitive agents still write deliverables to disk via `bash`,
   * and the projector needs an observation root to scan against the
   * mtime baseline. Null only when the company has no workspace at
   * all (genuinely nowhere to look).
   *
   * For `lockMode='exclusive'` this is always the same path as
   * `workspace.localPath`. For `lockMode='none'` this is the
   * company's primary/oldest workspace localPath, picked by
   * `getCompanyObservationWorkspace`.
   *
   * Decoupling observation from locking is what fixes the regression
   * where cognitive agents wrote 19 files but the DocumentCenter
   * surfaced only 1: previously `workspacePath` shared the lock
   * decision, so any non-exclusive run lost its projector.
   */
  observationPath: string | null;
}

export class WorkspaceConfigurationError extends Error {
  readonly code = "WORKSPACE_UNRESOLVED";
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceConfigurationError";
  }
}

/**
 * Accept the widened shapes call sites actually pass. `projectId`
 * lives as `string | null | undefined` in several historical call
 * sites (legacy inline types). `role` and `department` remain in the
 * input shape for existing call sites; lock inference reads only
 * workspaceId from the agent.
 */
type TaskInput = {
  workspaceId: TaskRecord["workspaceId"];
  projectId?: TaskRecord["projectId"] | undefined;
  requiresFilesystem?: boolean;
};

type AgentInput = Pick<AgentRecord, "workspaceId"> & {
  role?: string | null;
  department?: AgentRecord["department"];
};

/**
 * Decide whether this (task, agent) pair should hold the workspace
 * exclusive for the duration of the run. Returns the mode and the
 * workspace-id the lock should sit on; callers load the row
 * afterwards.
 *
 * Decision table:
 *
 *   1. `task.workspaceId` set -> exclusive on that workspace
 *      (explicit opt-in by the task author, e.g. PR branch tasks).
 *
 *   2. Task signals filesystem need (`requiresFilesystem === true`)
 *      -> exclusive on agent.workspaceId / project primary. Throws if
 *      neither exists.
 *
 *   3. Otherwise -> none / null. Pure cognitive work: strategy,
 *      planning, document drafting, financial analysis, PM decisions
 *      runs with no workspace and no lock.
 */
function inferLockMode(
  db: AppDatabase,
  task: TaskInput | null,
  agent: AgentInput,
  companyId: string,
): { lockMode: WorkspaceLockMode; workspaceId: string | null; source: WorkspaceResolutionSource } {
  // Rule 1: task-level explicit workspace binding is the strongest
  // signal available: the task row literally names the workspace.
  if (task?.workspaceId) {
    return { lockMode: "exclusive", workspaceId: task.workspaceId, source: "task" };
  }

  if (task?.requiresFilesystem !== true) {
    return { lockMode: "none", workspaceId: null, source: "none" };
  }

  // Rule 2: filesystem-touching task -> agent workspace first, then
  // project primary.
  if (agent.workspaceId) {
    return { lockMode: "exclusive", workspaceId: agent.workspaceId, source: "agent" };
  }

  const projectWorkspace = db.workspacesMod.getProjectPrimaryWorkspace(
    task?.projectId ?? null,
    companyId,
  );
  if (projectWorkspace) {
    return {
      lockMode: "exclusive",
      workspaceId: projectWorkspace.id,
      source: "project",
    };
  }

  throw new WorkspaceConfigurationError(
    `Task requires a filesystem-backed run but no workspace is bound to the task, agent, or project (companyId=${companyId}, taskId=${task?.workspaceId === undefined ? "<null-task>" : (task as { id?: string }).id ?? "<unknown>"}, agentId=${(agent as { id?: string }).id ?? "<unknown>"}, projectId=${task?.projectId ?? "<null>"}).`,
  );
}

/**
 * Resolve the workspace + lock mode for a run context.
 *
 * Contract:
 *   - lockMode 'exclusive' => workspace is a live WorkspaceRecord.
 *   - lockMode 'none'      => workspace is null.
 *
 * Violations throw `WorkspaceConfigurationError` at resolve time so
 * the caller chooses how to recover (skip heartbeat, cancel run,
 * surface to operator). There is no silent mode degradation.
 */
export function resolveWorkspaceWithLockMode(
  db: AppDatabase,
  task: TaskInput | null,
  agent: AgentInput,
  companyId: string,
): WorkspaceResolution {
  const decision = inferLockMode(db, task, agent, companyId);

  if (decision.lockMode === "none") {
    // No lock claim, but the cognitive run can still touch the
    // filesystem via `bash`. Pick a stable observation root so the
    // artifact projector can baseline + diff the run's footprint.
    // `getCompanyObservationWorkspace` returns the primary or oldest
    // workspace; null only when the company has no workspace row at
    // all, in which case there is genuinely nothing to observe.
    const observation = db.workspacesMod.getCompanyObservationWorkspace(companyId);
    return {
      workspace: null,
      lockMode: "none",
      source: "none",
      observationPath: observation?.localPath ?? null,
    };
  }

  if (!decision.workspaceId) {
    throw new WorkspaceConfigurationError(
      `inferLockMode returned exclusive with no workspaceId (companyId=${companyId}); lock mode/workspace invariant broken.`,
    );
  }

  const workspace = db.workspacesMod.getWorkspace(decision.workspaceId);
  if (!workspace) {
    throw new WorkspaceConfigurationError(
      `Resolved workspace ${decision.workspaceId} does not exist (companyId=${companyId}, source=${decision.source}).`,
    );
  }
  if (workspace.companyId !== companyId) {
    throw new WorkspaceConfigurationError(
      `Resolved workspace ${workspace.id} belongs to company ${workspace.companyId}, not ${companyId}.`,
    );
  }

  return {
    workspace,
    lockMode: "exclusive",
    source: decision.source,
    // Exclusive runs observe the same path they lock.
    observationPath: workspace.localPath,
  };
}
