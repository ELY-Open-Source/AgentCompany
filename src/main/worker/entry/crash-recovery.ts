import type { WorkerServiceDependencies } from "./types";
import { resolveWorkspaceWithLockMode } from "../../orchestration/resolve-workspace";

export interface QueuedRunRecoveryCandidate {
  id: string;
  taskId: string | null;
  agentId: string;
  companyId: string;
  workspaceId: string | null;
  connectorId: string;
}

export function handleWorkerExit(
  code: number | null,
  {
    db,
    logger,
    isQuitting,
    publishDomainChanged,
    emitEvent: _emitEvent,
    wakeAgentIfPossible,
  }: Pick<WorkerServiceDependencies, "db" | "logger" | "isQuitting" | "publishDomainChanged" | "emitEvent" | "wakeAgentIfPossible">,
): QueuedRunRecoveryCandidate[] {
  if (isQuitting()) return [];

  logger.warn(`[worker] Worker exited with code ${code}, recovering...`);

  const snapshot = db.projection.snapshot.listSnapshot();
  const affectedAgentIds = new Set<string>();
  const affectedCompanyIds = new Map<string, string>();
  const requeueCandidates: QueuedRunRecoveryCandidate[] = [];

  for (const run of snapshot.runs) {
    if (run.status === "running") {
      db.core.runs.finishRun({
        runId: run.id,
        status: "interrupted",
        summary: "Worker process crashed.",
        errorMessage: "Worker process exited unexpectedly.",
        exitCode: code,
        signal: null,
        model: null,
        unattributedCost: true,
        recoverTaskForRetry: run.taskId !== null,
      });
      if (run.workspaceId) {
        db.core.workspaces.releaseWorkspaceLock(run.workspaceId, run.id);
      }
      affectedAgentIds.add(run.agentId);
      affectedCompanyIds.set(run.agentId, run.companyId);

      const chain = db.core.agents.getChainOfCommand(run.agentId);
      if (chain.length > 0) {
        wakeAgentIfPossible(chain[0].id, run.companyId, "report_failed");
      }
    } else if (run.status === "queued") {
      requeueCandidates.push({
        id: run.id,
        taskId: run.taskId,
        agentId: run.agentId,
        companyId: run.companyId,
        workspaceId: run.workspaceId,
        connectorId: run.connectorId,
      });
    }
  }

  for (const agentId of affectedAgentIds) {
    // EXEC-05: Promote deferred wakes after crash recovery
    const cid = affectedCompanyIds.get(agentId) ?? "";
    const promoted = db.automation.wakeup.promoteWakeupRequests(agentId, cid);
    if (promoted > 0) {
      logger.info(`[worker] Promoted ${promoted} deferred wake(s) for agent ${agentId} after crash recovery`);
    }
    const pendingWakeTrigger = db.automation.wakeup.getPreferredWakeTrigger(agentId, cid);
    wakeAgentIfPossible(agentId, cid, pendingWakeTrigger ?? "recovery");
  }

  publishDomainChanged();

  return requeueCandidates;
}

export function requeueQueuedRunsAfterWorkerRestart(
  requeueCandidates: QueuedRunRecoveryCandidate[],
  {
    db,
    logger,
    dispatchRunToWorker,
  }: Pick<WorkerServiceDependencies, "db" | "logger" | "dispatchRunToWorker">,
): void {
  if (requeueCandidates.length === 0) return;
  logger.info(`[worker] Re-enqueuing ${requeueCandidates.length} queued run(s) after worker restart.`);
  const recoverySnapshot = db.projection.snapshot.listSnapshot();
  for (const candidate of requeueCandidates) {
    try {
      const currentRun = db.core.runs.getRun(candidate.id);
      if (currentRun.status !== "queued") continue;
      // The crashed run may still own a workspace lock acquired during the
      // original dispatch; release it before re-dispatch so the replay
      // does not self-collide with "Workspace is locked by another run".
      if (candidate.workspaceId) {
        db.core.workspaces.releaseWorkspaceLock(candidate.workspaceId, candidate.id);
      }
      const task = candidate.taskId ? db.core.entity.getTask(candidate.taskId) : null;
      const agent = db.core.entity.getAgent(candidate.agentId);
      const connector = db.core.connectors.getConnector(agent.connectorId);
      const { workspace, lockMode, observationPath } = resolveWorkspaceWithLockMode(db, task, agent, candidate.companyId);
      const recoveryCompany = recoverySnapshot.companies.find((company) => company.id === candidate.companyId);

      dispatchRunToWorker({
        runId: candidate.id,
        companyId: candidate.companyId,
        agent,
        task,
        connector,
        workspace,
        workspaceMode: lockMode,
        observationPath,
        companyName: recoveryCompany?.name ?? "Company",
        companyDescription: recoveryCompany?.description ?? "",
        snapshot: recoverySnapshot,
        trigger: "recovery",
      });
    } catch (error) {
      logger.warn(`[worker] Failed to re-enqueue run ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
      db.core.runs.finishRun({
        runId: candidate.id,
        status: "interrupted",
        summary: "Could not re-enqueue after worker restart.",
        errorMessage: error instanceof Error ? error.message : String(error),
        exitCode: null,
        signal: null,
        model: null,
        unattributedCost: true,
        recoverTaskForRetry: candidate.taskId !== null,
      });
      if (candidate.workspaceId) {
        db.core.workspaces.releaseWorkspaceLock(candidate.workspaceId, candidate.id);
      }
    }
  }
}
