import type { AutomationTrigger, AutomationAction, RunRecord } from "@shared/types";
import type { AutomationDependencies, AutomationEventContext, RunFinishedEvent } from "./types";
import { matchesConditions, matchesEventConfig } from "./automation-conditions";
import { executeAutomationAction } from "./automation-actions";
import type { ActionDeps, ActionCallbacks } from "./automation-actions";
import { runWorkflowPipeline } from "./automation-workflow";
import type { WorkflowDeps } from "./automation-workflow";
import { processRunCompletion } from "./automation-run-completion";
import type { RunCompletionDeps, RunCompletionCallbacks } from "./automation-run-completion";
import { handleApprovalResolved } from "./automation-approval-handler";
import type { ApprovalHandlerDeps, ApprovalHandlerCallbacks } from "./automation-approval-handler";
import { handleTaskStatusChange, handleTaskCreated } from "./automation-handlers";
import type { HandlerDeps } from "./automation-handlers";

export type { AutomationEventContext } from "./types";
export { autoAssignSkillsToAgent } from "./automation-skills";

export function createAutomationService({
  db,
  logger,
  emitEvent,
  publishDomainChanged,
  notify,
  wakeAgentIfPossible,
  dispatchBrowserAction,
  isQuitting,
}: AutomationDependencies) {
  const activeAutomationExecutions = new Set<string>();
  const activeWorkflowTriggerExecutions = new Set<string>();
  const pendingScheduledTimers = new Set<ReturnType<typeof setTimeout>>();

  const actionDeps: ActionDeps = {
    db,
    logger,
    emitEvent,
    publishDomainChanged,
    wakeAgentIfPossible,
  };

  const workflowDeps: WorkflowDeps = {
    db,
    logger,
    publishDomainChanged,
  };

  const handlerDeps: HandlerDeps = {
    db,
    logger,
    publishDomainChanged,
    notify,
    wakeAgentIfPossible,
    dispatchBrowserAction,
    isQuitting,
  };

  const approvalDeps: ApprovalHandlerDeps = {
    db,
    logger,
    publishDomainChanged,
    notify,
    wakeAgentIfPossible,
    dispatchBrowserAction,
    isQuitting,
  };

  const runCompletionDeps: RunCompletionDeps = {
    db,
    logger,
    publishDomainChanged,
    notify,
    wakeAgentIfPossible,
  };

  // Forward-declared so callbacks can reference each other
  function _runWorkflowPipeline(workflowId: string, companyId: string): Promise<void> {
    return runWorkflowPipeline(workflowId, companyId, workflowDeps, actionDeps, actionCallbacks);
  }

  function _handleTaskCreated(taskId: string, companyId: string): void {
    handleTaskCreated(handlerDeps, { dispatchAutomation }, taskId, companyId);
  }

  function _handleApprovalResolved(approvalId: string, companyId: string, decision: string): void {
    handleApprovalResolved(approvalDeps, approvalCallbacks, approvalId, companyId, decision);
  }

  function _handleTaskStatusChange(taskId: string, companyId: string, previousStatus: string, newStatus: string): void {
    handleTaskStatusChange(handlerDeps, { dispatchAutomation }, taskId, companyId, previousStatus, newStatus);
  }

  const actionCallbacks: ActionCallbacks = {
    handleTaskCreated: _handleTaskCreated,
    handleApprovalResolved: _handleApprovalResolved,
    handleTaskStatusChange: _handleTaskStatusChange,
  };

  const approvalCallbacks: ApprovalHandlerCallbacks = {
    dispatchAutomation,
    handleTaskStatusChange: _handleTaskStatusChange,
    runWorkflowPipeline: _runWorkflowPipeline,
    trackTimer: (timer) => { pendingScheduledTimers.add(timer); },
  };

  const runCompletionCallbacks: RunCompletionCallbacks = {
    dispatchAutomation,
    handleTaskStatusChange: _handleTaskStatusChange,
  };

  function evaluateAutomationRules(trigger: string, ctx: AutomationEventContext) {
    try {
      const rules = db.listActiveAutomationRules(ctx.companyId, trigger);
      for (const rule of rules) {
        if (!matchesConditions(db, rule, ctx)) continue;
        const executionKey = JSON.stringify({
          ruleId: rule.id,
          trigger,
          companyId: ctx.companyId,
          taskId: ctx.taskId ?? null,
          agentId: ctx.agentId ?? null,
          runId: ctx.runId ?? null,
          previousStatus: ctx.previousStatus ?? null,
          newStatus: ctx.newStatus ?? null,
        });
        if (activeAutomationExecutions.has(executionKey)) {
          logger.warn(`[automation] Skipping re-entrant execution for rule "${rule.name}" (${executionKey})`);
          continue;
        }
        activeAutomationExecutions.add(executionKey);
        try {
          executeAutomationAction(actionDeps, actionCallbacks, rule, ctx);
          db.recordAutomationExecution(
            rule.id,
            ctx.companyId,
            rule.name,
            trigger,
            rule.action,
            `Fired for ${trigger} in context: taskId=${ctx.taskId ?? "n/a"}, agentId=${ctx.agentId ?? "n/a"}`,
          );
          emitEvent({
            type: "automation-fired",
            ruleId: rule.id,
            ruleName: rule.name,
            trigger: trigger as AutomationTrigger,
            action: rule.action as AutomationAction,
          });
          logger.info(`[automation] Fired rule "${rule.name}" (${trigger} → ${rule.action})`);
        } catch (error) {
          logger.error(`[automation] Failed to execute action for rule "${rule.name}": ${error instanceof Error ? error.message : String(error)}`);
          db.recordAutomationExecution(
            rule.id,
            ctx.companyId,
            rule.name,
            trigger,
            rule.action,
            `FAILED: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          activeAutomationExecutions.delete(executionKey);
        }
      }
    } catch (error) {
      logger.error(`[automation] Error evaluating rules for trigger "${trigger}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function evaluateWorkflowTriggers(trigger: string, ctx: AutomationEventContext) {
    try {
      const workflows = db.listTriggerableWorkflows(ctx.companyId, trigger);
      for (const workflow of workflows) {
        if (!matchesEventConfig(db, workflow.triggerConfigJson, null, ctx)) continue;
        const executionKey = JSON.stringify({
          workflowId: workflow.id,
          trigger,
          companyId: ctx.companyId,
          taskId: ctx.taskId ?? null,
          agentId: ctx.agentId ?? null,
          runId: ctx.runId ?? null,
          previousStatus: ctx.previousStatus ?? null,
          newStatus: ctx.newStatus ?? null,
        });
        if (activeWorkflowTriggerExecutions.has(executionKey)) {
          logger.warn(`[workflow] Skipping re-entrant trigger for workflow "${workflow.name}" (${executionKey})`);
          continue;
        }
        activeWorkflowTriggerExecutions.add(executionKey);
        void _runWorkflowPipeline(workflow.id, ctx.companyId)
          .then(() => {
            logger.info(`[workflow] Triggered workflow "${workflow.name}" via ${trigger}`);
          })
          .catch((error) => {
            logger.error(`[workflow] Trigger failed for "${workflow.name}": ${error instanceof Error ? error.message : String(error)}`);
          })
          .finally(() => {
            activeWorkflowTriggerExecutions.delete(executionKey);
          });
      }
    } catch (error) {
      logger.error(`[workflow] Error evaluating workflow triggers for "${trigger}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function dispatchAutomation(trigger: string, ctx: AutomationEventContext) {
    if (isQuitting()) return;
    evaluateAutomationRules(trigger, ctx);
    evaluateWorkflowTriggers(trigger, ctx);
  }

  function destroy() {
    for (const timer of pendingScheduledTimers) {
      clearTimeout(timer);
    }
    pendingScheduledTimers.clear();
  }

  return {
    runWorkflowPipeline: _runWorkflowPipeline,
    dispatchAutomation,
    processRunCompletion: (run: RunRecord, event: RunFinishedEvent) =>
      processRunCompletion(runCompletionDeps, runCompletionCallbacks, run, event, isQuitting),
    handleApprovalResolved: _handleApprovalResolved,
    handleTaskStatusChange: _handleTaskStatusChange,
    handleTaskCreated: _handleTaskCreated,
    destroy,
  };
}
