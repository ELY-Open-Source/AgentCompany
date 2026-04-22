import type { RunRecord } from "@shared/types";
import type { RunFinishedEvent } from "../automation/types";
import type { createOrchestrationService } from "../orchestration-service";
import type { AutomationDispatch } from "../orchestration/types";

type OrchestrationServiceEvents = Pick<
  ReturnType<typeof createOrchestrationService>,
  "wakeAgentIfPossible" | "dispatchRunToWorker"
>;

type AutomationServiceEvents = {
  dispatchAutomation: (trigger: string, ctx: AutomationDispatch) => void;
  processRunCompletion: (run: RunRecord, event: RunFinishedEvent) => void;
};

export function createServiceEventHub() {
  let orchestration: OrchestrationServiceEvents | null = null;
  let automation: AutomationServiceEvents | null = null;

  function requireOrchestration(): OrchestrationServiceEvents {
    if (!orchestration) {
      throw new Error("Service event hub orchestration handlers are not registered.");
    }
    return orchestration;
  }

  function requireAutomation(): AutomationServiceEvents {
    if (!automation) {
      throw new Error("Service event hub automation handlers are not registered.");
    }
    return automation;
  }

  return {
    registerOrchestration(service: OrchestrationServiceEvents): void {
      if (orchestration) {
        throw new Error("Service event hub orchestration handlers are already registered.");
      }
      orchestration = service;
    },
    registerAutomation(service: AutomationServiceEvents): void {
      if (automation) {
        throw new Error("Service event hub automation handlers are already registered.");
      }
      automation = service;
    },
    hasOrchestrationHandlers(): boolean {
      return Boolean(orchestration);
    },
    wakeAgentIfPossible: (
      agentId: string | null | undefined,
      companyId: string,
      trigger: string,
    ) => requireOrchestration().wakeAgentIfPossible(agentId, companyId, trigger),
    dispatchRunToWorker: (
      params: Parameters<OrchestrationServiceEvents["dispatchRunToWorker"]>[0],
    ) => {
      requireOrchestration().dispatchRunToWorker(params);
    },
    dispatchAutomation: (trigger: string, ctx: AutomationDispatch) => {
      requireAutomation().dispatchAutomation(trigger, ctx);
    },
    processRunCompletion: (run: RunRecord, event: RunFinishedEvent) => {
      requireAutomation().processRunCompletion(run, event);
    },
    assertReady(): void {
      requireOrchestration();
      requireAutomation();
    },
    clear(): void {
      orchestration = null;
      automation = null;
    },
  };
}
