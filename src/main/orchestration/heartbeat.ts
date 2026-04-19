import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../database";
import type { AgentRecord, ConnectorRecord } from "@shared/types";
import type { OrchestrationDependencies } from "./types";
import type { RunDispatchParams } from "./turn-context";
import { pickModelForAgent } from "../model-dispatch";

/**
 * Every reason a heartbeat attempt can be rejected before a run is
 * dispatched. The enum is closed so callers (scheduler, UI) can reason
 * about persistence and operator display exhaustively.
 */
export type HeartbeatSkipReason =
  | "quitting"
  | "worker_not_ready"
  | "company_inactive"
  | "cross_company"
  | "agent_not_runnable"
  | "budget_blocked"
  | "connector_not_ready"
  | "connector_model_not_allowed"
  | "max_concurrent_runs"
  | "cooldown"
  | "wake_on_demand_disabled"
  | "pending_approval"
  | "awaiting_user_review"
  | "pending_deliverable_review"
  | "checkout_race_lost"
  | "no_actionable_tasks";

export type HeartbeatStartResult =
  | { status: "started"; runId: string }
  | { status: "skipped"; reason: HeartbeatSkipReason };

const SKIPPED = (reason: HeartbeatSkipReason): HeartbeatStartResult => ({
  status: "skipped",
  reason,
});

export function createHeartbeat(
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

  function ensureAgentHeartbeatEnabled(agentId: string) {
    const agent = db.getAgent(agentId);
    if (!agent.heartbeatEnabled) {
      db.setHeartbeat(agentId, true, agent.heartbeatIntervalSec || 120);
    }
  }

  function startAgentHeartbeatRun(agentId: string, companyId: string, trigger: string): HeartbeatStartResult {
    if (isQuitting()) return SKIPPED("quitting");
    const isMessageWake = trigger === "message";
    const isCommunicationWake = isMessageWake || trigger === "peer_request";
    if (!hasWorkerReady()) return SKIPPED("worker_not_ready");
    const companyStatus = db.getCompanyStatus(companyId);
    if (companyStatus !== "active") return SKIPPED("company_inactive");
    const agent = db.getAgent(agentId);
    if (agent.companyId !== companyId) {
      logger.warn(`[heartbeat] Refusing cross-company run for agent ${agentId}: ${agent.companyId} !== ${companyId}`);
      return SKIPPED("cross_company");
    }
    const assignment = pickModelForAgent(agent, {
      getConnector: (id) => db.getConnector(id),
      getDisabledModels: (id) => db.getDisabledModels(agent.companyId, id),
      getCeoAssignment: (cid) => {
        const ceo = db.getCeoForCompany(cid);
        if (!ceo) return null;
        const full = db.getAgent(ceo.id);
        return { connectorId: full.connectorId, modelId: full.model ?? null };
      },
      listModelCapabilities: () => db.modelCapabilities.listModelCapabilities(),
      readConnectors: () => db.connectorsCrud.readConnectors(),
    });
    const connector = db.getConnector(assignment.connectorId);
    const effectiveAgentForEligibility: AgentRecord = { ...agent, model: assignment.modelId };
    const eligibilityFailure = getRunEligibilityFailure(effectiveAgentForEligibility, connector, null);
    if (eligibilityFailure) {
      // getRunEligibilityFailure returns one of three string codes; map to
      // the corresponding skip reason so the caller can surface it.
      const mapped: HeartbeatSkipReason =
        eligibilityFailure === "AGENT_NOT_RUNNABLE"
          ? "agent_not_runnable"
          : eligibilityFailure === "BUDGET_POLICY_BLOCKED"
            ? "budget_blocked"
            : eligibilityFailure === "CONNECTOR_NOT_READY"
              ? "connector_not_ready"
              : "connector_model_not_allowed";
      return SKIPPED(mapped);
    }
    // Extended heartbeat policy checks (Paperclip parity).
    // Let getHeartbeatPolicy throw — a missing row signals data corruption
    // and silently falling back hides the gate that decides whether the
    // agent runs at all.
    const heartbeatPolicy = db.getHeartbeatPolicy(agent.id);

    // maxConcurrentRuns check: count active runs for this agent
    const activeRunCount = db.countActiveRunsForAgent(agent.id, companyId);
    if (activeRunCount >= heartbeatPolicy.maxConcurrentRuns) return SKIPPED("max_concurrent_runs");

    // Cooldown check: ensure enough time has passed since last heartbeat
    if (!isMessageWake && agent.lastHeartbeatAt) {
      const elapsed = Date.now() - new Date(agent.lastHeartbeatAt).getTime();
      const cooldownMs = heartbeatPolicy.cooldownSec * 1000;
      if (elapsed < cooldownMs) return SKIPPED("cooldown");
    }

    // wakeOnDemand gate: if disabled, only timer/bootstrap triggers allowed
    if (!heartbeatPolicy.wakeOnDemand && trigger !== "timer" && trigger !== "bootstrap") {
      return SKIPPED("wake_on_demand_disabled");
    }
    if (db.isAgentPendingApproval(agentId)) return SKIPPED("pending_approval");

    const companyMode = db.getCompanyExecutionMode(companyId);
    const approvalSettings = db.getCompanyApprovalSettings(companyId);
    const shouldEnforceHumanReview =
      companyMode === "ai_cofounder" || approvalSettings?.reviewDeliverables === true;

    // Block heartbeat when agent has tasks awaiting user deliverable review
    if (
      shouldEnforceHumanReview &&
      !isMessageWake &&
      (db.hasAgentPendingDeliverableReview(agentId, companyId) || db.hasAgentTaskAwaitingReview(agentId, companyId))
    ) {
      return SKIPPED("awaiting_user_review");
    }

    // Block CEO heartbeat when company has any pending deliverable reviews
    if (
      shouldEnforceHumanReview &&
      !isMessageWake &&
      !agent.reportsTo &&
      db.hasPendingDeliverableReviews(companyId)
    ) {
      return SKIPPED("pending_deliverable_review");
    }

    const assignedTasks = isCommunicationWake
      ? []
      : db.listAgentTasks(agentId, companyId, ["todo", "in_progress", "blocked"]);
    const isTimer = trigger === "timer";
    const candidateTasks = assignedTasks;

    const candidateTask = candidateTasks.find((entry) => !entry.activeRunId) ?? null;
    const runId = randomUUID();
    let task: ReturnType<AppDatabase["getTask"]> | null = null;

    if (candidateTask) {
      const checkoutSuccess = db.checkoutTask(candidateTask.id, runId);
      if (!checkoutSuccess) {
        db.addActivity({
          companyId,
          actor: "system",
          action: "execution.checkout_rejected",
          entityType: "task",
          entityId: candidateTask.id,
          detail: `Agent ${agent.name} lost checkout race on task "${candidateTask.title}"`,
        });
        return SKIPPED("checkout_race_lost");
      }
      task = db.getTask(candidateTask.id);
    } else {
      const hasActiveAssignedRun = candidateTasks.some(
        (entry) => entry.activeRunId && hasActiveRun({ taskId: entry.id, companyId }),
      );
      if (hasActiveAssignedRun) return SKIPPED("max_concurrent_runs");

      const isCeo = !agent.reportsTo;
      const isManager = db.getDirectReports(agent.id, companyId).length > 0;
      const goalCount = db.countActiveGoalsForCompany(companyId);
      const taskCount = db.countActiveTasksForCompany(companyId);
      const companyNeedsBootstrap = goalCount > 0 && taskCount < goalCount;

      if (isTimer && !isCeo && !isManager && !companyNeedsBootstrap) {
        return SKIPPED("no_actionable_tasks");
      }

      // No task — this is a true heartbeat run. The run row carries
      // task_id = NULL; workspace falls back to agent/project/company.
      task = null;
      logger.info(`[heartbeat] Starting taskless heartbeat run for ${agent.name}`);
    }

    const workspaceResolution = resolveWorkspace(task, agent, companyId);
    const workspace = workspaceResolution.workspace;
    logger.info(
      `[heartbeat] Workspace resolution for ${agent.name}: task.workspaceId=${task?.workspaceId ?? "null"}, agent.workspaceId=${agent.workspaceId ?? "null"}, projectId=${task?.projectId ?? "null"}, source=${workspaceResolution.source}, mode=${workspaceResolution.lockMode}, resolved=${workspace?.name ?? "NONE"}, localPath=${workspace?.localPath ?? "NONE"}`,
    );

    const run = db.createRun({
      id: runId,
      companyId,
      taskId: task?.id ?? null,
      agentId: agent.id,
      workspaceId: workspaceResolution.lockMode === "exclusive" ? (workspace?.id ?? null) : null,
      connectorId: connector.id,
    });

    const companyBasic = db.getCompanyBasic(companyId);
    dispatchRunToWorker({
      runId: run.id,
      companyId,
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

    db.markHeartbeatAt(agentId);

    // Actor audit: record what triggered this run
    try {
      const actorType = trigger === "timer" || trigger === "bootstrap" ? "system" : "agent";
      const actorId = trigger === "timer" || trigger === "bootstrap" ? null : trigger;
      db.updateRunActor(run.id, actorType, actorId);
    } catch (error) {
      logger.warn(
        `[heartbeat] updateRunActor failed for run ${run.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    db.addActivity({
      companyId,
      actor: "system",
      action: "heartbeat.triggered",
      entityType: "agent",
      entityId: agent.id,
      detail: `${trigger} heartbeat for ${agent.name}`,
    });
    emitEvent({ type: "run-updated", runId: run.id, action: "created" });
    return { status: "started", runId: run.id };
  }

  function wakeAgentIfPossible(agentId: string | null | undefined, companyId: string, trigger: string, context?: Record<string, unknown>) {
    if (!agentId || isQuitting()) return null;
    try {
      const agent = db.getAgent(agentId);
      if (agent.companyId !== companyId) {
        logger.warn(`[wake] Refusing cross-company wake for agent ${agentId}: ${agent.companyId} !== ${companyId}`);
        return null;
      }
    } catch (error) {
      logger.warn(`[wake] Failed to load agent ${agentId}:`, error);
      return null;
    }
    try {
      ensureAgentHeartbeatEnabled(agentId);
    } catch (error) {
      logger.warn(`[wake] Failed to ensure heartbeat for agent ${agentId}:`, error);
      return null;
    }

    const agentBusy = hasActiveRun({ agentId, companyId });
    if (agentBusy) {
      db.enqueueWakeupRequest(companyId, agentId, trigger, `Wake for agent: ${trigger}`, context);
      return null;
    }

    const result = startAgentHeartbeatRun(agentId, companyId, trigger);
    if (result.status === "skipped") {
      db.enqueueWakeupRequest(companyId, agentId, trigger, `Wake for agent (deferred:${result.reason}): ${trigger}`, context);
      return null;
    }
    db.completePendingWakeupRequests(agentId, companyId, result.runId);
    return result.runId;
  }

  return {
    ensureAgentHeartbeatEnabled,
    startAgentHeartbeatRun,
    wakeAgentIfPossible,
  };
}
