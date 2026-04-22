import type { AppDatabase } from "../database";
import type { AutomationAction, DesktopEvent } from "@shared/types";
import type { AutomationEventContext } from "./types";
import type { AutomationActionConfigMap } from "./automation-action-schemas";

export interface ActionDeps {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  emitEvent: (event: DesktopEvent) => void;
  publishDomainChanged: () => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
}

export interface ActionCallbacks {
  handleTaskCreated: (taskId: string, companyId: string) => void;
  handleApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
  handleTaskStatusChange: (taskId: string, companyId: string, previousStatus: string, newStatus: string) => void;
}

export interface AutomationRuleInput {
  id?: string;
  name?: string;
  action: string;
  actionConfigJson: string;
  targetDepartment: string | null;
  trigger?: string;
}

export interface AutomationRuleExecution extends Omit<AutomationRuleInput, "action"> {
  action: AutomationAction;
}

export type AutomationActionExecution = {
  deps: ActionDeps;
  callbacks: ActionCallbacks;
  rule: AutomationRuleExecution;
  ctx: AutomationEventContext;
  config: AutomationActionConfigMap[AutomationAction];
};

export type TypedAutomationActionExecution<K extends AutomationAction> = Omit<AutomationActionExecution, "config"> & {
  config: AutomationActionConfigMap[K];
};

export type TypedAutomationActionHandler<K extends AutomationAction> = (input: TypedAutomationActionExecution<K>) => void;
export type AutomationActionHandler = (input: AutomationActionExecution) => void;

export function createAutomationActionHandler<K extends AutomationAction>(
  action: K,
  handler: TypedAutomationActionHandler<K>,
): AutomationActionHandler {
  return (input) => {
    if (input.rule.action !== action) {
      throw new Error(`Automation handler ${action} received ${input.rule.action}.`);
    }
    handler(input as TypedAutomationActionExecution<K>);
  };
}
