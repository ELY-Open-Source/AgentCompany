import { getConnectorExecutionReadinessIssue } from "@shared/connector-policy";
import type { ConnectorRecord } from "@shared/types";
import type { OrchestrationDependencies } from "./types";
import { buildRunPayload, type RunDispatchParams } from "./turn-context";
import { validateConnectorModelSelection } from "../connector-model-policy";
import { resolveWorkspaceWithLockMode } from "./resolve-workspace";

export function createRunDispatch(deps: OrchestrationDependencies) {
  const {
    db,
    logger,
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

  function resolveWorkspace(
    task: { workspaceId: string | null; projectId?: string | null } | null,
    agent: { workspaceId: string | null },
    companyId: string,
  ) {
    return resolveWorkspaceWithLockMode(db, task, agent, companyId);
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
    const modelSelection = validateConnectorModelSelection(db, agent.companyId, connector.id, agent.model ?? null);
    if (!modelSelection.ok) {
      logger.info(`[run] Agent ${agent.name} connector model blocked: ${modelSelection.error}`);
      return "CONNECTOR_MODEL_NOT_ALLOWED";
    }
    return null;
  }

  function dispatchRunToWorker(params: RunDispatchParams) {
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
    if (
      params.workspaceMode === "exclusive" &&
      params.workspace &&
      !db.claimWorkspaceLock(params.workspace.id, params.runId)
    ) {
      db.finishRun({
        runId: params.runId,
        status: "cancelled",
        summary: null,
        errorMessage: `Workspace ${params.workspace.id} is in use by another run; will retry on the next heartbeat.`,
        exitCode: null,
        signal: null,
        model: null,
        unattributedCost: true,
      });
      return;
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
  }

  return { resolveWorkspace, getRunEligibilityFailure, dispatchRunToWorker };
}
