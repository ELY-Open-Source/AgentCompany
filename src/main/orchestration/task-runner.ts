import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../database";
import type { AgentRecord, ConnectorRecord } from "@shared/types";
import type { DesktopResult } from "@shared/contracts";
import type { OrchestrationDependencies } from "./types";
import type { RunDispatchParams } from "./turn-context";
import { pickModelForAgent } from "../model-dispatch";

export function createTaskRunner(
  deps: OrchestrationDependencies,
  resolveWorkspace: (task: { workspaceId: string | null; projectId?: string | null } | null, agent: { workspaceId: string | null }, companyId: string) => { workspace: ReturnType<AppDatabase["getWorkspace"]>; lockMode: "exclusive" | "shared" | "none"; source: string },
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

  function queueTaskRun(taskId: string, trigger: string, actor: string): DesktopResult<string> {
    if (isQuitting()) {
      return fail("APP_SHUTTING_DOWN", "Application is shutting down.");
    }
    if (!hasWorkerReady()) {
      logger.warn(`[run] Worker not ready — cannot queue run for task ${taskId} (trigger: ${trigger})`);
      return fail("WORKER_UNAVAILABLE", "Orchestration worker is not ready.");
    }
    const task = db.entityCrud.getTask(taskId);
    const companyStatus = db.company.getCompanyStatus(task.companyId);
    if (companyStatus !== "active") {
      return fail("COMPANY_NOT_ACTIVE", "Runs can only start while the company is active.");
    }
    if (!task.assigneeAgentId) return fail("TASK_UNASSIGNED", "Assign an agent before starting a run.");
    const agent = db.entityCrud.getAgent(task.assigneeAgentId);
    if (agent.companyId !== task.companyId) {
      return fail("AGENT_COMPANY_MISMATCH", "The assigned agent does not belong to the task company.");
    }
    const pick = pickModelForAgent(agent, {
      getConnector: (id) => db.getConnector(id),
      getDisabledModels: (id) => db.getDisabledModels(agent.companyId, id),
      listModelCapabilities: () => db.modelCapabilities.listModelCapabilities(),
      readConnectors: () => db.connectorsCrud.readConnectors(),
    });
    if (!pick.ok) {
      return fail("MODEL_PICK_FAILED", pick.message);
    }
    const assignment = pick.assignment;
    const connector = db.getConnector(assignment.connectorId);
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
    if (db.agents.isAgentPendingApproval(agent.id)) {
      return fail("AGENT_PENDING_APPROVAL", "This agent is pending hire approval and cannot run tasks.");
    }
    const blockingApproval = db.approvalsMod.getBlockingApproval(task.companyId, agent.id, task.id);
    if (blockingApproval) {
      return fail(
        "APPROVAL_GATE_BLOCKED",
        `Run blocked by pending approval: ${blockingApproval.type} — "${blockingApproval.payloadSummary}". Approve or reject before starting.`,
      );
    }

    // CAS checkout — atomic claim (EXEC-01, EXEC-02)
    const runId = randomUUID();
    const checkoutSuccess = db.tasks.checkoutTask(task.id, runId);
    if (!checkoutSuccess) {
      return fail("CHECKOUT_RACE_LOST", "Another run claimed this task. Refresh and try again.");
    }

    const workspaceResolution = resolveWorkspace(task, agent, task.companyId);
    const workspace = workspaceResolution.workspace;
    if (workspace && workspace.companyId !== task.companyId) {
      return fail("WORKSPACE_COMPANY_MISMATCH", "The selected workspace does not belong to the task company.");
    }

    const run = db.runs.createRun({
      id: runId,
      companyId: task.companyId,
      taskId: task.id,
      agentId: agent.id,
      workspaceId: workspaceResolution.lockMode === "exclusive" ? (workspace?.id ?? null) : null,
      connectorId: connector.id,
    });

    const companyBasic = db.company.getCompanyBasic(task.companyId);
    dispatchRunToWorker({
      runId: run.id,
      companyId: task.companyId,
      agent,
      task,
      connector,
      workspace,
      workspaceMode: workspaceResolution.lockMode,
      companyName: companyBasic?.name ?? "Unknown",
      companyDescription: companyBasic?.description ?? "",
      snapshot: db.listSnapshot(),
      trigger,
      resolvedModel: assignment.modelId,
    });
    db.addActivity({
      companyId: task.companyId,
      actor,
      action: "run.queued",
      entityType: "run",
      entityId: run.id,
      detail: task.title,
    });
    emitEvent({ type: "run-updated", runId: run.id, action: "created" });
    return ok(run.id);
  }

  function resumeQueuedRuns() {
    // D-02: Stale lock recovery at app startup (EXEC-03)
    try {
      const recovered = db.recoverStaleLocks();
      for (const task of recovered) {
        db.addActivity({
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
    const snapshot = db.listSnapshot();
    const companiesById = new Map(snapshot.companies.map((company) => [company.id, company]));

    for (const run of db.runs.listQueuedRuns()) {
      const company = companiesById.get(run.companyId);
      if (!company || company.status !== "active") {
        continue;
      }

      const hasBlockingSiblingRun = snapshot.runs.some((entry) =>
        entry.id !== run.id &&
        entry.companyId === run.companyId &&
        ["queued", "running"].includes(entry.status) &&
        (entry.taskId === run.taskId || entry.agentId === run.agentId),
      );
      if (hasBlockingSiblingRun) {
        continue;
      }

      try {
        const task = run.taskId ? db.entityCrud.getTask(run.taskId) : null;
        const agent = db.entityCrud.getAgent(run.agentId);
        const connector = db.getConnector(run.connectorId);
        const eligibilityFailure = getRunEligibilityFailure(agent, connector, task?.projectId ?? null);
        if (eligibilityFailure) {
          if (eligibilityFailure === "CONNECTOR_MODEL_NOT_ALLOWED") {
            db.runs.finishRun({
              runId: run.id,
              status: "failed",
              summary: "Queued run rejected during recovery because the agent model is disabled or invalid for its connector.",
              errorMessage: "Connector model is disabled or invalid for this agent.",
              exitCode: null,
              signal: null,
              model: null,
              unattributedCost: true,
            });
            db.addActivity({
              companyId: run.companyId,
              actor: "system",
              action: "run.recovery_blocked",
              entityType: "run",
              entityId: run.id,
              detail: `Recovered queued run blocked by connector/model policy for task "${task?.title ?? "(heartbeat)"}"`,
            });
            emitEvent({ type: "run-updated", runId: run.id, action: "completed" });
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
          companyName: company.name,
          companyDescription: company.description,
          snapshot,
          trigger: "recovery",
        });
      } catch (error) {
        logger.warn(`[run] Skipped queued run recovery for ${run.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { queueTaskRun, resumeQueuedRuns };
}
