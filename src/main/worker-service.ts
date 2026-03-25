import { utilityProcess } from "electron";
import { z } from "zod";
import { getConnectorDefinition } from "./connectors";
import type { AppDatabase } from "./database";
import type { RunRecord } from "@shared/types";
import type { NotificationOptions } from "./notification-service";

const runStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled", "timed_out", "interrupted"]);
export const workerMessageSchema = z.union([
  z.object({
    type: z.literal("run-log"),
    runId: z.string().uuid(),
    stream: z.enum(["stdout", "stderr"]),
    chunk: z.string(),
  }),
  z.object({
    type: z.literal("run-status"),
    runId: z.string().uuid(),
    status: runStatusSchema,
    message: z.string(),
  }),
  z.object({
    type: z.literal("run-finished"),
    runId: z.string().uuid(),
    status: runStatusSchema,
    summary: z.string().nullable(),
    errorMessage: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    model: z.string().nullable(),
    sessionParams: z.record(z.string(), z.unknown()).nullable(),
    sessionDisplayId: z.string().nullable(),
    costUsd: z.number().nullable(),
    unattributedCost: z.boolean(),
  }),
]);
type WorkerUiEvent = Extract<z.infer<typeof workerMessageSchema>, { type: "run-log" | "run-status" }>;

interface WorkerServiceDependencies {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  workerPath: string;
  isQuitting: () => boolean;
  publishDomainChanged: () => void;
  emitEvent: (event: WorkerUiEvent) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
  dispatchRunToWorker: (params: {
    runId: string;
    companyId: string;
    agent: ReturnType<AppDatabase["getAgent"]>;
    task: ReturnType<AppDatabase["getTask"]>;
    connector: ReturnType<AppDatabase["getConnector"]>;
    workspace: ReturnType<AppDatabase["getWorkspace"]>;
    workspaceMode: "exclusive" | "shared" | "none";
    companyName: string;
    companyDescription: string;
    snapshot: ReturnType<AppDatabase["listSnapshot"]>;
    trigger: string;
  }) => void;
  processRunCompletion: (run: RunRecord, event: z.infer<typeof workerMessageSchema> & { type: "run-finished" }) => void;
  notify: (options: NotificationOptions) => void;
}

export function createWorkerService({
  db,
  logger,
  workerPath,
  isQuitting,
  publishDomainChanged,
  emitEvent,
  wakeAgentIfPossible,
  dispatchRunToWorker,
  processRunCompletion,
  notify,
}: WorkerServiceDependencies) {
  const MAX_RETRY_ATTEMPTS = 2;
  const RETRY_COOLDOWN_MS = 30_000; // 30 seconds
  const consecutiveWakeMap = new Map<string, number>();
  const MAX_CONSECUTIVE_WAKES = 5;

  let worker: ReturnType<typeof utilityProcess.fork> | null = null;
  let destroyed = false;
  const pendingRetryTimers = new Set<ReturnType<typeof setTimeout>>();

  function getWorker() {
    if (destroyed) return null;
    return worker;
  }

  function createWorker() {
    worker = utilityProcess.fork(workerPath, [], {
      stdio: "pipe",
      serviceName: "AgentCompany Orchestrator",
    });

    worker.stdout?.on("data", (chunk) => logger.info(`[worker] ${String(chunk).trim()}`));
    worker.stderr?.on("data", (chunk) => logger.error(`[worker] ${String(chunk).trim()}`));

    worker.on("exit", (code) => {
      if (isQuitting() || destroyed) return;

      logger.warn(`[worker] Worker exited with code ${code}, recovering...`);

      const snapshot = db.listSnapshot();
      const affectedAgentIds = new Set<string>();
      const requeueCandidates: Array<{ id: string; taskId: string; agentId: string; companyId: string; workspaceId: string | null; connectorId: string }> = [];

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
            sessionDisplayId: null,
            costUsd: null,
            unattributedCost: true,
          });
          if (run.workspaceId) {
            db.releaseWorkspaceLock(run.workspaceId, run.id);
          }
          affectedAgentIds.add(run.agentId);

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
        const pendingWakes = db.consumePendingWakes(agentId);
        for (const wake of pendingWakes) {
          wakeAgentIfPossible(agentId, wake.companyId, wake.trigger);
        }
      }

      publishDomainChanged();

      createWorker();

      if (requeueCandidates.length > 0 && worker) {
        logger.info(`[worker] Re-enqueuing ${requeueCandidates.length} queued run(s) after worker restart.`);
        const recoverySnapshot = db.listSnapshot();
        for (const candidate of requeueCandidates) {
          try {
            const task = db.getTask(candidate.taskId);
            const agent = db.getAgent(candidate.agentId);
            const connector = db.getConnector(agent.connectorId);
            const workspaceResolution = {
              taskWorkspace: db.getWorkspace(task.workspaceId),
              agentWorkspace: db.getWorkspace(agent.workspaceId),
              projectWorkspace: db.getProjectPrimaryWorkspace(task.projectId ?? null, candidate.companyId),
            };
            const workspace = workspaceResolution.taskWorkspace
              ?? workspaceResolution.agentWorkspace
              ?? workspaceResolution.projectWorkspace
              ?? db.getAnyCompanyWorkspace(candidate.companyId);
            const workspaceMode = workspaceResolution.taskWorkspace || workspaceResolution.agentWorkspace || workspaceResolution.projectWorkspace
              ? "exclusive"
              : workspace
                ? "shared"
                : "none";
            const recoveryCompany = recoverySnapshot.companies.find((company) => company.id === candidate.companyId);

            dispatchRunToWorker({
              runId: candidate.id,
              companyId: candidate.companyId,
              agent,
              task,
              connector,
              workspace,
              workspaceMode,
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
              sessionDisplayId: null,
              costUsd: null,
              unattributedCost: true,
            });
            if (candidate.workspaceId) {
              db.releaseWorkspaceLock(candidate.workspaceId, candidate.id);
            }
          }
        }
      }
    });

    worker.on("message", async (message) => {
      let event: z.infer<typeof workerMessageSchema>;
      try {
        event = workerMessageSchema.parse(message);
      } catch (error) {
        logger.error("[worker] invalid message payload", error);
        return;
      }

      if (event.type === "run-log") {
        await db.appendRunLog(event.runId, event.stream, event.chunk);
        emitEvent(event);
        return;
      }

      if (event.type === "run-status") {
        db.markRunStatus(event.runId, event.status, event.message);
        if (event.status === "running") {
          const run = db.listSnapshot().runs.find((entry) => entry.id === event.runId);
          if (run?.workspaceId && !db.claimWorkspaceLock(run.workspaceId, run.id)) {
            logger.error(`[workspace] Failed to claim lock for workspace ${run.workspaceId} when run ${run.id} entered running state. Cancelling run.`);
            worker?.postMessage({ type: "cancel-run", runId: run.id });
          }
        }
        emitEvent(event);
        publishDomainChanged();
        return;
      }

      const snapshot = db.listSnapshot();
      const run = snapshot.runs.find((entry) => entry.id === event.runId);
      if (!run) {
        return;
      }

      const connector = getConnectorDefinition(run.connectorId);

      let task: ReturnType<AppDatabase["getTask"]> | null = null;
      try {
        task = db.getTask(run.taskId);
      } catch {
        task = null;
      }

      if (task) {
        if (event.sessionParams && connector.module.sessionCodec) {
          const serialized = connector.module.sessionCodec.serialize(event.sessionParams);
          db.updateTaskSession(task.id, serialized, connector.module.sessionCodec.getDisplayId?.(serialized ?? null) ?? event.sessionDisplayId ?? null);
        }
        if (!event.sessionParams) {
          db.updateTaskSession(task.id, null, null);
        }
      }

      const runOutcome = db.finishRun(event);
      if (run.workspaceId) {
        db.releaseWorkspaceLock(run.workspaceId, run.id);
      }
      db.addActivity({
        companyId: run.companyId,
        actor: run.agentId,
        action: `run.${event.status}`,
        entityType: "run",
        entityId: run.id,
        detail: event.summary ?? event.errorMessage ?? "",
      });
      publishDomainChanged();
      emitEvent({
        type: "run-status",
        runId: run.id,
        status: event.status,
        message: event.summary ?? event.errorMessage ?? event.status,
      });
      if ((event.status === "failed" || event.status === "timed_out" || event.status === "interrupted") && task) {
        notify({
          title: "Task Failed",
          body: `${task.title} -- manual intervention needed`,
          urgency: "informational",
          navigation: { section: "tasks", entityId: task.id },
          batchKey: "failed_runs",
        });
      }

      let updatedAgent: ReturnType<AppDatabase["getAgent"]> | null = null;
      try {
        updatedAgent = db.getAgent(run.agentId);
      } catch {
        updatedAgent = null;
      }

      if (updatedAgent && runOutcome.budgetHardStopped) {
        db.addActivity({
          companyId: updatedAgent.companyId,
          actor: "system",
          action: "agent.auto_paused",
          entityType: "agent",
          entityId: updatedAgent.id,
          detail: `Budget exhausted at ${updatedAgent.spentMonthlyUsd.toFixed(2)} / ${updatedAgent.budgetMonthlyUsd.toFixed(2)} USD.`,
        });
        notify({
          title: "Agent Paused",
          body: `${updatedAgent.name} paused -- budget limit reached`,
          urgency: "informational",
          navigation: { section: "agents", entityId: updatedAgent.id },
          batchKey: "agent_paused",
        });
        publishDomainChanged();
      }

      if ((event.status === "failed" || event.status === "timed_out") && !isQuitting() && !destroyed) {
        const retryCount = db.getTaskRetryCount(run.taskId);

        if (retryCount < MAX_RETRY_ATTEMPTS) {
          // Retry same agent after cooldown
          db.incrementTaskRetryCount(run.taskId);
          db.advanceTaskStatus(run.taskId, "todo",
            `Run ${event.status} (attempt ${retryCount + 1}/${MAX_RETRY_ATTEMPTS}). Auto-retrying after ${RETRY_COOLDOWN_MS / 1000}s cooldown.`);
          logger.info(`[escalation] Retrying task ${run.taskId} (attempt ${retryCount + 1}/${MAX_RETRY_ATTEMPTS}) for agent ${run.agentId}`);
          const retryTimer = setTimeout(() => {
            pendingRetryTimers.delete(retryTimer);
            if (isQuitting() || destroyed) return;
            wakeAgentIfPossible(run.agentId, run.companyId, "retry_failed");
          }, RETRY_COOLDOWN_MS);
          pendingRetryTimers.add(retryTimer);
        } else {
          // Retry limit reached -- escalate up the chain
          db.resetTaskRetryCount(run.taskId);
          logger.warn(`[escalation] Task ${run.taskId} failed ${MAX_RETRY_ATTEMPTS} times. Escalating to manager.`);

          let escalated = false;
          try {
            const chain = db.getChainOfCommand(run.agentId);
            if (chain.length > 0) {
              wakeAgentIfPossible(chain[0].id, run.companyId, "report_failed");
              escalated = true;
              logger.info(`[escalation] Escalated task ${run.taskId} to manager ${chain[0].name} (${chain[0].id})`);
            }
          } catch {
            // Chain lookup failed (agent deleted)
          }

          if (!escalated) {
            // No manager found -- try CEO
            try {
              const ceo = db.getCeoForCompany(run.companyId);
              if (ceo) {
                wakeAgentIfPossible(ceo.id, run.companyId, "report_failed");
                escalated = true;
                logger.info(`[escalation] Escalated task ${run.taskId} to CEO ${ceo.name} (${ceo.id})`);
              }
            } catch { /* CEO lookup failed */ }
          }

          if (!escalated) {
            // No one to escalate to -- notify user
            const taskTitle = task?.title ?? run.taskId;
            notify({
              title: "Attention Required",
              body: `${taskTitle} needs manual intervention`,
              urgency: "critical",
              navigation: { section: "tasks", entityId: run.taskId },
            });
            logger.error(`[escalation] Task ${run.taskId} failed with no escalation target. User notified.`);
          }
        }
      }

      const pendingWakes = db.consumePendingWakes(run.agentId);
      if (pendingWakes.length > 0 && !isQuitting() && !destroyed) {
        for (const wake of pendingWakes) {
          wakeAgentIfPossible(run.agentId, wake.companyId, wake.trigger);
        }
      }

      if (!isQuitting() && !destroyed) {
        processRunCompletion(run, event as z.infer<typeof workerMessageSchema> & { type: "run-finished" });
      }

      // Reset retry count on successful completion
      if (event.status === "succeeded") {
        try { db.resetTaskRetryCount(run.taskId); } catch { /* best effort */ }
      }

      // Reset circuit breaker when a task actually progressed (successful run)
      if (event.status === "succeeded") {
        const wakeKey = `${run.agentId}:${run.companyId}`;
        consecutiveWakeMap.delete(wakeKey);
      }

      // Self-wake with circuit breaker to prevent infinite loops
      if (pendingWakes.length === 0 && !isQuitting() && !destroyed) {
        try {
          const actionableTasks = db.listAgentTasks(run.agentId, run.companyId, ["todo", "in_progress"]);
          if (actionableTasks.length > 0) {
            const wakeKey = `${run.agentId}:${run.companyId}`;
            const consecutiveCount = consecutiveWakeMap.get(wakeKey) ?? 0;

            if (consecutiveCount >= MAX_CONSECUTIVE_WAKES) {
              logger.warn(`[self-wake] Circuit breaker: agent ${run.agentId} has self-woken ${consecutiveCount} times without progress. Pausing self-wake.`);
              consecutiveWakeMap.delete(wakeKey);
              // Escalate to manager since agent is stuck
              try {
                const chain = db.getChainOfCommand(run.agentId);
                if (chain.length > 0) {
                  wakeAgentIfPossible(chain[0].id, run.companyId, "report_stuck");
                }
              } catch { /* best effort */ }
            } else {
              consecutiveWakeMap.set(wakeKey, consecutiveCount + 1);
              wakeAgentIfPossible(run.agentId, run.companyId, "task_continuation");
            }
          }
        } catch {
          // Best-effort self-wake; agent will pick up work on the next heartbeat cycle.
        }
      }
    });
  }

  function destroy() {
    destroyed = true;

    // Clear all pending retry timers so they never fire after quit
    for (const timer of pendingRetryTimers) {
      clearTimeout(timer);
    }
    pendingRetryTimers.clear();

    if (worker) {
      // Cancel all running/queued runs in the worker before killing it.
      // This tells the worker to SIGTERM all child CLI processes (claude, codex, etc.)
      const snapshot = db.listSnapshot();
      for (const run of snapshot.runs) {
        if (run.status === "running" || run.status === "queued") {
          try {
            worker.postMessage({ type: "cancel-run", runId: run.id });
          } catch { /* worker may already be dead */ }
        }
      }

      worker.kill();
      // Force-kill after 2s if SIGTERM didn't work (child CLI processes may keep it alive)
      const ref = worker;
      setTimeout(() => {
        try { ref.kill(); } catch { /* already dead */ }
      }, 2000);
      worker = null;
    }
  }

  return {
    createWorker,
    getWorker,
    destroy,
  };
}
