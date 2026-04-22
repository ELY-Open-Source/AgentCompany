import type { AutomationAction } from "@shared/types";
import { AUTOMATION_ACTION_HANDLERS } from "./automation-action-handlers";
import { isAutomationAction, parseActionConfig } from "./automation-action-schemas";
import type {
  ActionCallbacks,
  ActionDeps,
  AutomationRuleExecution,
  AutomationRuleInput,
} from "./automation-action-runtime";
import type { AutomationEventContext } from "./types";

export { AUTOMATION_ACTION_HANDLERS } from "./automation-action-handlers";
export type { ActionCallbacks, ActionDeps } from "./automation-action-runtime";

export function executeAutomationAction(
  deps: ActionDeps,
  callbacks: ActionCallbacks,
  rule: AutomationRuleInput,
  ctx: AutomationEventContext,
): void {
  const action = parseAutomationAction(rule.action);
  const executionRule: AutomationRuleExecution = { ...rule, action };
  const config = parseActionConfig(action, rule.actionConfigJson);
  AUTOMATION_ACTION_HANDLERS[action]({ deps, callbacks, rule: executionRule, ctx, config });
}

function parseAutomationAction(action: string): AutomationAction {
  if (isAutomationAction(action)) return action;
  throw new Error(`Unknown automation action: ${action}`);
}
