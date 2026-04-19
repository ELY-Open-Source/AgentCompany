import type { OrchestrationDependencies } from "./types";
import type { HeartbeatStartResult } from "./heartbeat";
import { createHeartbeatScheduler } from "./scheduler-heartbeat";
import { createLockRecoveryScheduler } from "./scheduler-lock-recovery";
import { createIdleAutomationScheduler } from "./scheduler-idle-automation";
import { createHousekeepingScheduler } from "./scheduler-housekeeping";

export function createScheduler(
  deps: OrchestrationDependencies,
  hasActiveRun: (filter: { taskId?: string; agentId?: string; companyId: string }) => boolean,
  startAgentHeartbeatRun: (agentId: string, companyId: string, trigger: string) => HeartbeatStartResult,
  wakeAgentIfPossible: (agentId: string, companyId: string, trigger: string) => string | null | undefined,
) {
  const heartbeat = createHeartbeatScheduler(deps, hasActiveRun, startAgentHeartbeatRun);
  const lockRecovery = createLockRecoveryScheduler(deps);
  const idleAutomation = createIdleAutomationScheduler(deps);
  const housekeeping = createHousekeepingScheduler(deps, wakeAgentIfPossible);

  function startAllSchedulers() {
    heartbeat.start();
    lockRecovery.start();
    idleAutomation.start();
    housekeeping.start();
  }

  function stopAllSchedulers() {
    heartbeat.stop();
    lockRecovery.stop();
    idleAutomation.stop();
    housekeeping.stop();
  }

  return { startAllSchedulers, stopAllSchedulers };
}
