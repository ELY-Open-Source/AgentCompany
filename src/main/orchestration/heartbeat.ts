import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../database";
import type { AgentRecord, ConnectorRecord } from "@shared/types";
import type { OrchestrationDependencies } from "./types";
import type { RunDispatchParams } from "./turn-context";
import { HEARTBEAT_TASK_TITLE_PREFIX } from "./heartbeat-task";

export function createHeartbeat(
  deps: OrchestrationDependencies,
  resolveWorkspace: (task: { workspaceId: string | null; projectId?: string | null }, agent: { workspaceId: string | null }, companyId: string) => { workspace: ReturnType<AppDatabase["getWorkspace"]>; lockMode: "exclusive" | "shared" | "none"; source: string },
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

  function startAgentHeartbeatRun(agentId: string, companyId: string, trigger: string): string | null {
    if (isQuitting()) return null;
    const isMessageWake = trigger === "message";
    const isCommunicationWake = isMessageWake || trigger === "peer_request";
    if (!hasWorkerReady()) return null;
    const companyStatus = db.getCompanyStatus(companyId);
    if (companyStatus !== "active") {
      logger.debug(`[heartbeat] Skipping ${agentId} because company ${companyId} is not active.`);
      return null;
    }
    const agent = db.getAgent(agentId);
    if (agent.companyId !== companyId) {
      logger.warn(`[heartbeat] Refusing cross-company run for agent ${agentId}: ${agent.companyId} !== ${companyId}`);
      return null;
    }
    const connector = db.getConnector(agent.connectorId);
    if (getRunEligibilityFailure(agent, connector, null)) {
      return null;
    }
    // Extended heartbeat policy checks (Paperclip parity).
    // Let getHeartbeatPolicy throw — a missing row signals data corruption
    // and silently falling back hides the gate that decides whether the
    // agent runs at all.
    const heartbeatPolicy = db.getHeartbeatPolicy(agent.id);

    // maxConcurrentRuns check: count active runs for this agent
    const activeRunCount = db.countActiveRunsForAgent(agent.id, companyId);
    if (activeRunCount >= heartbeatPolicy.maxConcurrentRuns) {
      logger.debug(`[heartbeat] Skipping ${agent.name} — active runs (${activeRunCount}) >= maxConcurrentRuns (${heartbeatPolicy.maxConcurrentRuns}).`);
      return null;
    }

    // Cooldown check: ensure enough time has passed since last heartbeat
    if (!isMessageWake && agent.lastHeartbeatAt) {
      const elapsed = Date.now() - new Date(agent.lastHeartbeatAt).getTime();
      const cooldownMs = heartbeatPolicy.cooldownSec * 1000;
      if (elapsed < cooldownMs) {
        logger.debug(`[heartbeat] Skipping ${agent.name} — cooldown (${heartbeatPolicy.cooldownSec}s) not elapsed.`);
        return null;
      }
    }

    // wakeOnDemand gate: if disabled, only timer/bootstrap triggers allowed
    if (!heartbeatPolicy.wakeOnDemand && trigger !== "timer" && trigger !== "bootstrap") {
      logger.debug(`[heartbeat] Skipping ${agent.name} — wakeOnDemand is disabled and trigger is "${trigger}".`);
      return null;
    }
    if (db.isAgentPendingApproval(agentId)) {
      logger.debug(`[heartbeat] Skipping ${agent.name} because agent is pending hire approval.`);
      return null;
    }

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
      logger.debug(`[heartbeat] Skipping ${agent.name} — awaiting user deliverable review.`);
      return null;
    }

    // Block CEO heartbeat when company has any pending deliverable reviews
    if (
      shouldEnforceHumanReview &&
      !isMessageWake &&
      !agent.reportsTo &&
      db.hasPendingDeliverableReviews(companyId)
    ) {
      logger.debug(`[heartbeat] Skipping CEO ${agent.name} — company has pending deliverable reviews.`);
      return null;
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
        logger.info(`[heartbeat] Agent ${agent.name} lost checkout race on task ${candidateTask.title}`);
        return null;
      }
      task = db.getTask(candidateTask.id);
    } else {
      const hasActiveAssignedRun = candidateTasks.some(
        (entry) => entry.activeRunId && hasActiveRun({ taskId: entry.id, companyId }),
      );
      if (hasActiveAssignedRun) {
        return null;
      }

      const isCeo = !agent.reportsTo;
      const isManager = db.getDirectReports(agent.id, companyId).length > 0;
      const goalCount = db.countActiveGoalsForCompany(companyId);
      const taskCount = db.countActiveTasksForCompany(companyId);
      const companyNeedsBootstrap = goalCount > 0 && taskCount < goalCount;

      if (isTimer && !isCeo && !isManager && !companyNeedsBootstrap) {
        logger.debug(`[heartbeat] Skipping ${agent.name} — no actionable tasks and trigger is timer.`);
        return null;
      }

      const taskTitle = isCeo
        ? `${HEARTBEAT_TASK_TITLE_PREFIX} ${agent.name} — Strategic planning & task delegation`
        : isManager
          ? `${HEARTBEAT_TASK_TITLE_PREFIX} ${agent.name} — Review team & delegate work`
          : `${HEARTBEAT_TASK_TITLE_PREFIX} ${agent.name} — Check for work`;
      const taskDescription = isCeo
        ? "Review active company goals. Break each goal into projects and actionable tasks. Assign tasks to department leads and team members. Create tasks using the API. This is your primary responsibility as CEO — ensure every goal has a clear execution plan with assigned owners."
        : isManager
          ? "Review your department's goals and your team's workload. Create tasks for your direct reports if they have capacity. Review any work submitted for your approval. Ensure your team is productive and unblocked."
          : `Automated heartbeat run for ${agent.name}. Review assigned tasks, check goals, and take action as needed.`;

      task = db.acquireHeartbeatTask({
        agentId,
        companyId,
        runId,
        workspaceId: agent.workspaceId ?? null,
        title: taskTitle,
        description: taskDescription,
        priority: isCeo ? "high" : "medium",
      });
      if (!task) {
        return null;
      }
      logger.info(`[heartbeat] Acquired heartbeat task for ${agent.name}: ${task.title}`);
    }

    const workspaceResolution = resolveWorkspace(task, agent, companyId);
    const workspace = workspaceResolution.workspace;
    logger.info(
      `[heartbeat] Workspace resolution for ${agent.name}: task.workspaceId=${task.workspaceId ?? "null"}, agent.workspaceId=${agent.workspaceId ?? "null"}, projectId=${task.projectId ?? "null"}, source=${workspaceResolution.source}, mode=${workspaceResolution.lockMode}, resolved=${workspace?.name ?? "NONE"}, localPath=${workspace?.localPath ?? "NONE"}`,
    );

    const run = db.createRun({
      id: runId,
      companyId,
      taskId: task.id,
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
    });

    db.markHeartbeatAt(agentId);

    // Actor audit: record what triggered this run
    try {
      const actorType = trigger === "timer" || trigger === "bootstrap" ? "system" : "agent";
      const actorId = trigger === "timer" || trigger === "bootstrap" ? null : trigger;
      db.updateRunActor(run.id, actorType, actorId);
    } catch { /* Non-fatal */ }

    db.addActivity({
      companyId,
      actor: "system",
      action: "heartbeat.triggered",
      entityType: "agent",
      entityId: agent.id,
      detail: `${trigger} heartbeat for ${agent.name}`,
    });
    emitEvent({ type: "run-updated", runId: run.id, action: "created" });
    return run.id;
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

    const runId = startAgentHeartbeatRun(agentId, companyId, trigger);
    if (!runId) {
      db.enqueueWakeupRequest(companyId, agentId, trigger, `Wake for agent (deferred): ${trigger}`, context);
      return null;
    }
    db.completePendingWakeupRequests(agentId, companyId, runId);
    return runId;
  }

  return {
    ensureAgentHeartbeatEnabled,
    startAgentHeartbeatRun,
    wakeAgentIfPossible,
  };
}
