import type { WorkerServiceDependencies } from "./types";
import { resolveWorkspaceWithLockMode } from "../../orchestration/resolve-workspace";

export function handleWorkerExit(
  code: number | null,
  {
    db,
    logger,
    isQuitting,
    publishDomainChanged,
    emitEvent: _emitEvent,
    wakeAgentIfPossible,
    dispatchRunToWorker,
  }: Pick<WorkerServiceDependencies, "db" | "logger" | "isQuitting" | "publishDomainChanged" | "emitEvent" | "wakeAgentIfPossible" | "dispatchRunToWorker">,
  createWorker: () => void,
  getWorker: () => ReturnType<typeof import("electron").utilityProcess.fork> | null,
) {
  if (isQuitting()) return;

  logger.warn(`[worker] Worker exited with code ${code}, recovering...`);

  const snapshot = db.listSnapshot();
  const affectedAgentIds = new Set<string>();
  const affectedCompanyIds = new Map<string, string>();
  const requeueCandidates: Array<{
    id: string;
    taskId: string | null;
    agentId: string;
    companyId: string;
    workspaceId: string | null;
    connectorId: string;
  }> = [];

  for (const run of snapshot.runs) {
    if (run.status === "running") {
      db.finishRun({
        runId: run.id,
        status: "interrupted",
        summary: "Worker process crashed.",
        errorMessage: "Worker process exited unexpectedly.",
        exitCode: code,
        signal: null,
        model: null,
        unattributedCost: true,
      });
      if (run.workspaceId) {
        db.releaseWorkspaceLock(run.workspaceId, run.id);
      }
      // EXEC-02: Release execution lock on crash recovery
      if (run.taskId) {
        db.releaseTaskLock(run.taskId, run.id);
      }
      affectedAgentIds.add(run.agentId);
      affectedCompanyIds.set(run.agentId, run.companyId);

      const chain = db.getChainOfCommand(run.agentId);
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
    const promoted = db.promoteWakeupRequests(agentId, cid);
    if (promoted > 0) {
      logger.info(`[worker] Promoted ${promoted} deferred wake(s) for agent ${agentId} after crash recovery`);
    }
    const pendingWakeTrigger = db.getPreferredWakeTrigger(agentId, cid);
    if (pendingWakeTrigger) {
      wakeAgentIfPossible(agentId, cid, pendingWakeTrigger);
    }
  }

  publishDomainChanged();

  createWorker();

  const worker = getWorker();
  if (requeueCandidates.length > 0 && worker) {
    logger.info(`[worker] Re-enqueuing ${requeueCandidates.length} queued run(s) after worker restart.`);
    const recoverySnapshot = db.listSnapshot();
    for (const candidate of requeueCandidates) {
      try {
        // The crashed run may still own a workspace lock acquired during the
        // original dispatch; release it before re-dispatch so the replay
        // does not self-collide with "Workspace is locked by another run".
        if (candidate.workspaceId) {
          db.releaseWorkspaceLock(candidate.workspaceId, candidate.id);
        }
        const task = candidate.taskId ? db.getTask(candidate.taskId) : null;
        const agent = db.getAgent(candidate.agentId);
        const connector = db.getConnector(agent.connectorId);
        const { workspace, lockMode } = resolveWorkspaceWithLockMode(db, task, agent, candidate.companyId);
        const recoveryCompany = recoverySnapshot.companies.find((company) => company.id === candidate.companyId);

        dispatchRunToWorker({
          runId: candidate.id,
          companyId: candidate.companyId,
          agent,
          task,
          connector,
          workspace,
          workspaceMode: lockMode,
          companyName: recoveryCompany?.name ?? "Company",
          companyDescription: recoveryCompany?.description ?? "",
          snapshot: recoverySnapshot,
          trigger: "recovery",
        });
      } catch (error) {
        logger.warn(`[worker] Failed to re-enqueue run ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
        db.finishRun({
          runId: candidate.id,
          status: "interrupted",
          summary: "Could not re-enqueue after worker restart.",
          errorMessage: error instanceof Error ? error.message : String(error),
          exitCode: null,
          signal: null,
          model: null,
          unattributedCost: true,
        });
        if (candidate.workspaceId) {
          db.releaseWorkspaceLock(candidate.workspaceId, candidate.id);
        }
      }
    }
  }
}
