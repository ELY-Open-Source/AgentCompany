import { getConnectorExecutionReadinessIssue } from "@shared/connector-policy";
import type { AgentRecord, ConnectorRecord, DepartmentId, TaskRecord } from "@shared/types";
import type { OrchestrationDependencies } from "./types";
import { buildRunPayload, type RunDispatchParams } from "./turn-context";
import { validateConnectorModelSelection } from "../connector-model-policy";
import { resolveWorkspaceWithLockMode } from "./resolve-workspace";
import { AppError } from "../errors/index.js";

type ResolveWorkspaceTaskInput =
  | (Pick<TaskRecord, "workspaceId" | "projectId"> & { requiresFilesystem?: boolean })
  | null;

type ResolveWorkspaceAgentInput = Pick<AgentRecord, "workspaceId"> & {
  role?: string | null;
  department?: DepartmentId | null;
};

export type ResolveWorkspaceFn = (
  task: ResolveWorkspaceTaskInput,
  agent: ResolveWorkspaceAgentInput,
  companyId: string,
) => ReturnType<typeof resolveWorkspaceWithLockMode>;

export function createRunDispatch(deps: OrchestrationDependencies) {
  const {
    db,
    logger,
    emitEvent,
    isQuitting,
    hasWorkerReady,
    getApiPort,
    createRunToken,
    enqueueWorkerRun,
    listRuntimeSkillEntries,
    budgetService,
    getSessionHandoff,
    evaluatePreRunSessionRotation,
  } = deps;

  const resolveWorkspace: ResolveWorkspaceFn = (task, agent, companyId) =>
    resolveWorkspaceWithLockMode(db, task, agent, companyId);

  function formatDispatchError(error: unknown): string {
    if (error instanceof AppError) {
      return `[${error.code}] ${error.message}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  function failRunBeforeWorkerEnqueue(
    params: RunDispatchParams,
    error: unknown,
    workspaceLockClaimed: boolean,
  ): void {
    const errorMessage = formatDispatchError(error);
    logger.error(`[run] Dispatch failed before worker enqueue for ${params.runId}: ${errorMessage}`);
    db.core.runs.finishRun({
      runId: params.runId,
      status: "failed",
      summary: "Run failed before worker enqueue.",
      errorMessage,
      exitCode: null,
      signal: null,
      model: params.resolvedModel ?? null,
      unattributedCost: true,
    });
    if (workspaceLockClaimed && params.workspaceMode === "exclusive" && params.workspace) {
      db.core.workspaces.releaseWorkspaceLock(params.workspace.id, params.runId);
    }
    db.core.activity.addActivity({
      companyId: params.companyId,
      actor: params.agent.id,
      action: "run.failed",
      entityType: "run",
      entityId: params.runId,
      detail: errorMessage,
    });
    emitEvent({ type: "run-updated", runId: params.runId, action: "completed" });
  }

  function getRunEligibilityFailure(
    agent: { status: string; budgetMonthlyUsd: number; spentMonthlyUsd: number; name: string; connectorId: string; id: string; companyId: string; model?: string | null },
    connector: Pick<ConnectorRecord, "id" | "label" | "status" | "capabilityMatrix">,
    projectId: string | null = null,
  ) {
    if (["terminated", "paused", "pending_approval"].includes(agent.status)) {
      return "AGENT_NOT_RUNNABLE";
    }
    const gate = budgetService.evaluateBudgetGate(agent.companyId, agent.id, projectId);
    if (!gate.allowed) {
      logger.info(`[run] Agent ${agent.name} budget policy blocked: ${gate.blockedBy.map(b => `${b.scopeType}(${b.policyId})`).join(", ")}`);
      return "BUDGET_POLICY_BLOCKED";
    }
    const connectorIssue = getConnectorExecutionReadinessIssue(connector);
    if (connectorIssue) {
      const issue = connectorIssue ?? `Connector ${connector.id} is not execution-ready.`;
      logger.info(`[run] Agent ${agent.name} connector ${connector.id} blocked: ${issue}`);
      return "CONNECTOR_NOT_READY";
    }
    const modelSelection = validateConnectorModelSelection(
      {
        getConnector: (id) => db.core.connectors.getConnector(id),
        getDisabledModels: (cid, connId) => db.core.settings.getDisabledModels(cid, connId),
      },
      agent.companyId,
      connector.id,
      agent.model ?? null,
    );
    if (!modelSelection.ok) {
      logger.info(`[run] Agent ${agent.name} connector model blocked: ${modelSelection.error}`);
      return "CONNECTOR_MODEL_NOT_ALLOWED";
    }
    return null;
  }

  function dispatchRunToWorker(params: RunDispatchParams) {
    let workspaceLockClaimed = false;
    try {
      if (isQuitting()) {
        throw new Error("Application is shutting down — refusing to dispatch new run.");
      }
      if (!hasWorkerReady()) {
        throw new Error("Orchestration worker is not ready.");
      }
      const connectorIssue = getConnectorExecutionReadinessIssue(params.connector);
      if (connectorIssue) {
        throw new Error(connectorIssue);
      }

      // D-02: Claim the workspace lock synchronously before enqueuing the run.
      // Previously the worker claimed the lock only after it emitted `running`,
      // so two runs could race between enqueue and startup and both read the
      // same workspace mid-write. Main is the authoritative coordinator.
      //
      // On contention we mark the run `cancelled`, not `failed`. The Dashboard
      // "Needs attention" card only surfaces failed/timed_out/interrupted runs
      // (see src/renderer/components/dashboard/Dashboard.tsx), so the user is
      // not alarmed by a transient backoff. The task row is rolled back to
      // `todo` via the `finishRun` never-started branch, so heartbeat picks
      // it up on the next cycle with no manual intervention.
      if (params.workspaceMode === "exclusive" && params.workspace) {
        if (!db.core.workspaces.claimWorkspaceLock(params.workspace.id, params.runId)) {
          db.core.runs.finishRun({
            runId: params.runId,
            status: "cancelled",
            summary: null,
            errorMessage: `Workspace ${params.workspace.id} is in use by another run; will retry on the next heartbeat.`,
            exitCode: null,
            signal: null,
            model: null,
            unattributedCost: true,
          });
          emitEvent({ type: "run-updated", runId: params.runId, action: "completed" });
          return;
        }
        workspaceLockClaimed = true;
      }

      const payload = buildRunPayload(params, {
        db,
        logger,
        getApiPort,
        createRunToken,
        listRuntimeSkillEntries,
        getSessionHandoff,
        evaluatePreRunSessionRotation,
      });

      enqueueWorkerRun(payload);
    } catch (error) {
      failRunBeforeWorkerEnqueue(params, error, workspaceLockClaimed);
    }
  }

  return { resolveWorkspace, getRunEligibilityFailure, dispatchRunToWorker };
}
