import type { AgentRecord, ConnectorRecord } from "@shared/types";
import type { DesktopResult } from "@shared/contracts";
import type { OrchestrationDependencies } from "./types";
import type { RunDispatchParams } from "./turn-context";
import type { ResolveWorkspaceFn } from "./run-dispatch";
import { WorkspaceConfigurationError } from "./resolve-workspace";
import { pickModelForAgent } from "../model-dispatch";

interface PreparedTaskRun {
  runId: string;
  taskTitle: string;
  dispatchParams: RunDispatchParams;
}

export function createTaskRunner(
  deps: OrchestrationDependencies,
  resolveWorkspace: ResolveWorkspaceFn,
  getRunEligibilityFailure: (agent: AgentRecord, connector: ConnectorRecord, projectId?: string | null) => string | null,
  dispatchRunToWorker: (params: RunDispatchParams) => void,
  hasActiveRun: (filter: { taskId?: string; agentId?: string; companyId: string }) => boolean,
) {
  const {
    db,
    logger,
    emitEvent,
    hasWorkerReady,
    isQuitting,
  } = deps;

  function ok<T>(data: T): DesktopResult<T> {
    return { ok: true, data };
  }

  function fail(code: string, message: string): DesktopResult<never> {
    return { ok: false, error: { code, message } };
  }

  function prepareTaskRun(
    taskId: string,
    trigger: string,
    options: { requireWorkerReady: boolean },
  ): DesktopResult<PreparedTaskRun> {
    if (isQuitting()) {
      return fail("APP_SHUTTING_DOWN", "Application is shutting down.");
    }
    if (options.requireWorkerReady && !hasWorkerReady()) {
      logger.warn(`[run] Worker not ready — cannot queue run for task ${taskId} (trigger: ${trigger})`);
      return fail("WORKER_UNAVAILABLE", "Orchestration worker is not ready.");
    }
    const task = db.core.entity.getTask(taskId);
    const companyStatus = db.core.company.getCompanyStatus(task.companyId);
    if (companyStatus !== "active") {
      return fail("COMPANY_NOT_ACTIVE", "Runs can only start while the company is active.");
    }
    if (!task.assigneeAgentId) return fail("TASK_UNASSIGNED", "Assign an agent before starting a run.");
    const agent = db.core.entity.getAgent(task.assigneeAgentId);
    if (agent.companyId !== task.companyId) {
      return fail("AGENT_COMPANY_MISMATCH", "The assigned agent does not belong to the task company.");
    }
    const pick = pickModelForAgent(agent, {
      getConnector: (id) => db.core.connectors.getConnector(id),
      getDisabledModels: (companyId, connectorId) => db.core.settings.getDisabledModels(companyId, connectorId),
      listModelCapabilities: () => db.core.modelCapabilities.listModelCapabilities(),
      readConnectors: () => db.core.connectors.readConnectors(),
    });
    if (!pick.ok) {
      return fail("MODEL_PICK_FAILED", pick.message);
    }
    const assignment = pick.assignment;
    const connector = db.core.connectors.getConnector(assignment.connectorId);
    const effectiveAgentForEligibility: AgentRecord = { ...agent, model: assignment.modelId };
    const eligibilityFailure = getRunEligibilityFailure(effectiveAgentForEligibility, connector, task.projectId ?? null);
    if (eligibilityFailure === "AGENT_NOT_RUNNABLE") {
      return fail("AGENT_NOT_RUNNABLE", "The assigned agent is paused, pending approval, or terminated.");
    }
    if (eligibilityFailure === "BUDGET_POLICY_BLOCKED") {
      return fail("BUDGET_POLICY_BLOCKED", "A budget policy blocks this run. Review budget settings.");
    }
    if (eligibilityFailure === "CONNECTOR_NOT_READY") {
      return fail("CONNECTOR_NOT_READY", "The assigned agent connector is not ready.");
    }
    if (eligibilityFailure === "CONNECTOR_MODEL_NOT_ALLOWED") {
      return fail("CONNECTOR_MODEL_NOT_ALLOWED", "The assigned agent model is disabled or invalid for its connector.");
    }
    if (hasActiveRun({ agentId: agent.id, companyId: task.companyId })) {
      return fail("AGENT_ALREADY_RUNNING", "The assigned agent already has an active run.");
    }
    if (db.core.agents.isAgentPendingApproval(agent.id)) {
      return fail("AGENT_PENDING_APPROVAL", "This agent is pending hire approval and cannot run tasks.");
    }
    const blockingApproval = db.core.approvals.getBlockingApproval(task.companyId, agent.id, task.id);
    if (blockingApproval) {
      return fail(
        "APPROVAL_GATE_BLOCKED",
        `Run blocked by pending approval: ${blockingApproval.type} — "${blockingApproval.payloadSummary}". Approve or reject before starting.`,
      );
    }

    let workspaceResolution: ReturnType<typeof resolveWorkspace>;
    try {
      workspaceResolution = resolveWorkspace(task, agent, task.companyId);
    } catch (error) {
      if (error instanceof WorkspaceConfigurationError) {
        return fail("WORKSPACE_UNRESOLVED", error.message);
      }
      throw error;
    }
    const workspace = workspaceResolution.workspace;
    if (workspace && workspace.companyId !== task.companyId) {
      return fail("WORKSPACE_COMPANY_MISMATCH", "The selected workspace does not belong to the task company.");
    }

    const run = db.core.runs.createTaskRun({
      companyId: task.companyId,
      taskId: task.id,
      agentId: agent.id,
      workspaceId: workspaceResolution.lockMode === "exclusive" ? (workspace?.id ?? null) : null,
      connectorId: connector.id,
    });
    if (!run) {
      return fail("CHECKOUT_RACE_LOST", "Another run claimed this task. Refresh and try again.");
    }

    const companyBasic = db.core.company.getCompanyBasic(task.companyId);
    return ok({
      runId: run.id,
      taskTitle: task.title,
      dispatchParams: {
        runId: run.id,
        companyId: task.companyId,
        agent,
        task,
        connector,
        workspace,
        workspaceMode: workspaceResolution.lockMode,
        observationPath: workspaceResolution.observationPath,
        companyName: companyBasic?.name ?? "Unknown",
        companyDescription: companyBasic?.description ?? "",
        snapshot: db.projection.snapshot.listSnapshot(),
        trigger,
        resolvedModel: assignment.modelId,
      },
    });
  }

  function recordQueuedRun(prepared: PreparedTaskRun, actor: string) {
    const postDispatchRun = db.core.runs.getRun(prepared.runId);
    if (postDispatchRun.status === "queued" || postDispatchRun.status === "running") {
      db.core.activity.addActivity({
        companyId: prepared.dispatchParams.companyId,
        actor,
        action: "run.queued",
        entityType: "run",
        entityId: prepared.runId,
        detail: prepared.taskTitle,
      });
      emitEvent({ type: "run-updated", runId: prepared.runId, action: "created" });
    }
  }

  function dispatchPreparedTaskRun(prepared: PreparedTaskRun, actor: string) {
    dispatchRunToWorker(prepared.dispatchParams);
    recordQueuedRun(prepared, actor);
  }

  function queueTaskRun(taskId: string, trigger: string, actor: string): DesktopResult<string> {
    const prepared = prepareTaskRun(taskId, trigger, { requireWorkerReady: true });
    if (!prepared.ok) return prepared;
    dispatchPreparedTaskRun(prepared.data, actor);
    return ok(prepared.data.runId);
  }

  function createTaskRunForDeferredDispatch(taskId: string, trigger: string, actor: string): DesktopResult<{ runId: string; dispatchAfterCommit: () => void }> {
    const prepared = prepareTaskRun(taskId, trigger, { requireWorkerReady: false });
    if (!prepared.ok) return prepared;
    return ok({
      runId: prepared.data.runId,
      dispatchAfterCommit: () => {
        if (isQuitting()) return;
        if (!hasWorkerReady()) {
          logger.warn(`[run] Worker not ready — leaving queued run ${prepared.data.runId} for recovery (trigger: ${trigger})`);
          recordQueuedRun(prepared.data, actor);
          return;
        }
        dispatchPreparedTaskRun(prepared.data, actor);
      },
    });
  }

  function resumeQueuedRuns() {
    // D-02: Stale lock recovery at app startup (EXEC-03)
    try {
      const recovered = db.recoverStaleLocks();
      for (const task of recovered) {
        db.core.activity.addActivity({
          companyId: task.companyId,
          actor: "system",
          action: "execution.lock_recovered",
          entityType: "task",
          entityId: task.taskId,
          detail: `Recovered stale lock on task "${task.title}" after 15min timeout (startup sweep)`,
        });
        logger.info(`[init] Recovered stale lock on task ${task.taskId}: "${task.title}"`);
      }
      if (recovered.length > 0) {
        logger.info(`[init] Recovered ${recovered.length} stale lock(s) at startup`);
      }
    } catch (err) {
      logger.error(`[init] Stale lock recovery at startup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (isQuitting() || !hasWorkerReady()) {
      return;
    }
    const snapshot = db.projection.snapshot.listSnapshot();
    const companiesById = new Map(snapshot.companies.map((company) => [company.id, company]));
    const reservedAgentIds = new Set<string>();
    const reservedTaskIds = new Set<string>();

    function finishQueuedRecoveryRun(
      run: ReturnType<typeof db.core.runs.listQueuedRuns>[number],
      status: "cancelled" | "interrupted",
      summary: string,
      errorMessage: string | null,
    ): void {
      db.core.runs.finishRun({
        runId: run.id,
        status,
        summary,
        errorMessage,
        exitCode: null,
        signal: null,
        model: null,
        unattributedCost: true,
        recoverTaskForRetry: run.taskId !== null,
      });
      if (run.workspaceId) {
        db.core.workspaces.releaseWorkspaceLock(run.workspaceId, run.id);
      }
      emitEvent({ type: "run-updated", runId: run.id, action: "completed" });
    }

    for (const run of db.core.runs.listQueuedRuns()) {
      const company = companiesById.get(run.companyId);
      if (!company || company.status !== "active") {
        continue;
      }

      const hasRunningSiblingRun = snapshot.runs.some((entry) =>
        entry.id !== run.id &&
        entry.companyId === run.companyId &&
        entry.status === "running" &&
        (entry.taskId === run.taskId || entry.agentId === run.agentId),
      );
      if (hasRunningSiblingRun) {
        continue;
      }

      if (reservedAgentIds.has(run.agentId) || (run.taskId !== null && reservedTaskIds.has(run.taskId))) {
        finishQueuedRecoveryRun(
          run,
          "cancelled",
          "Queued run superseded during recovery.",
          null,
        );
        continue;
      }

      try {
        const task = run.taskId ? db.core.entity.getTask(run.taskId) : null;
        const agent = db.core.entity.getAgent(run.agentId);
        const connector = db.core.connectors.getConnector(run.connectorId);
        const blockingApproval = db.core.approvals.getBlockingApproval(run.companyId, agent.id, run.taskId);
        if (blockingApproval) {
          finishQueuedRecoveryRun(
            run,
            "cancelled",
            `Queued run blocked by pending approval: ${blockingApproval.type}`,
            null,
          );
          db.core.activity.addActivity({
            companyId: run.companyId,
            actor: "system",
            action: "run.recovery_blocked_approval",
            entityType: "run",
            entityId: run.id,
            detail: `Recovered queued run blocked by ${blockingApproval.type} for task "${task?.title ?? "(heartbeat)"}"`,
          });
          continue;
        }
        const eligibilityFailure = getRunEligibilityFailure(agent, connector, task?.projectId ?? null);
        if (eligibilityFailure) {
          if (eligibilityFailure === "CONNECTOR_MODEL_NOT_ALLOWED") {
            db.core.runs.finishRun({
              runId: run.id,
              status: "failed",
              summary: "Queued run rejected during recovery because the agent model is disabled or invalid for its connector.",
              errorMessage: "Connector model is disabled or invalid for this agent.",
              exitCode: null,
              signal: null,
              model: null,
              unattributedCost: true,
            });
            db.core.activity.addActivity({
              companyId: run.companyId,
              actor: "system",
              action: "run.recovery_blocked",
              entityType: "run",
              entityId: run.id,
              detail: `Recovered queued run blocked by connector/model policy for task "${task?.title ?? "(heartbeat)"}"`,
            });
            emitEvent({ type: "run-updated", runId: run.id, action: "completed" });
          } else {
            finishQueuedRecoveryRun(
              run,
              "cancelled",
              "Queued run recovery deferred by eligibility gate.",
              eligibilityFailure,
            );
            db.core.activity.addActivity({
              companyId: run.companyId,
              actor: "system",
              action: "run.recovery_deferred",
              entityType: "run",
              entityId: run.id,
              detail: `Recovered queued run deferred by ${eligibilityFailure} for task "${task?.title ?? "(heartbeat)"}"`,
            });
          }
          continue;
        }
        const workspaceResolution = resolveWorkspace(task ?? null, agent, run.companyId);
        dispatchRunToWorker({
          runId: run.id,
          companyId: run.companyId,
          agent,
          task,
          connector,
          workspace: workspaceResolution.workspace,
          workspaceMode: workspaceResolution.lockMode,
          observationPath: workspaceResolution.observationPath,
          companyName: company.name,
          companyDescription: company.description,
          snapshot,
          trigger: "recovery",
        });
        const currentRun = db.core.runs.getRun(run.id);
        if (currentRun.status === "queued" || currentRun.status === "running") {
          reservedAgentIds.add(run.agentId);
          if (run.taskId !== null) reservedTaskIds.add(run.taskId);
        }
      } catch (error) {
        logger.warn(`[run] Skipped queued run recovery for ${run.id}: ${error instanceof Error ? error.message : String(error)}`);
        finishQueuedRecoveryRun(
          run,
          "interrupted",
          "Queued run recovery failed.",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  return { queueTaskRun, createTaskRunForDeferredDispatch, resumeQueuedRuns };
}
