import type { OrchestrationDependencies } from "./types";
import { createRunDispatch } from "./run-dispatch";
import { createHeartbeat } from "./heartbeat";
import { createScheduler } from "./scheduler";
import { createTaskRunner } from "./task-runner";

export function createOrchestrationService(deps: OrchestrationDependencies) {
  const { db } = deps;

  function hasActiveRun(filter: { taskId?: string; agentId?: string; companyId: string }) {
    return db.hasActiveRun(filter);
  }

  const runDispatch = createRunDispatch(deps);
  const heartbeat = createHeartbeat(
    deps,
    runDispatch.resolveWorkspace,
    runDispatch.getRunEligibilityFailure,
    runDispatch.dispatchRunToWorker,
    hasActiveRun,
  );
  const scheduler = createScheduler(
    deps,
    hasActiveRun,
    heartbeat.startAgentHeartbeatRun,
    heartbeat.wakeAgentIfPossible,
  );
  const taskRunner = createTaskRunner(
    deps,
    runDispatch.resolveWorkspace,
    runDispatch.getRunEligibilityFailure,
    runDispatch.dispatchRunToWorker,
    hasActiveRun,
  );

  return {
    resolveWorkspace: runDispatch.resolveWorkspace,
    wakeAgentIfPossible: heartbeat.wakeAgentIfPossible,
    dispatchRunToWorker: runDispatch.dispatchRunToWorker,
    queueTaskRun: taskRunner.queueTaskRun,
    resumeQueuedRuns: taskRunner.resumeQueuedRuns,
    startAgentHeartbeatRun: heartbeat.startAgentHeartbeatRun,
    startAllSchedulers: scheduler.startAllSchedulers,
    stopAllSchedulers: scheduler.stopAllSchedulers,
  };
}
