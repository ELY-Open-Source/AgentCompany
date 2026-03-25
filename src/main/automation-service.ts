import type { AppDatabase } from "./database";
import type {
  AgentRecord,
  AutomationAction,
  AutomationTrigger,
  DesktopEvent,
  RunRecord,
  RunStatus,
} from "@shared/types";
import { dispatchAgentMessage } from "./message-dispatch";
import type { NotificationOptions } from "./notification-service";

/** Document types considered important enough to gate behind user review when reviewDeliverables is enabled. */
const IMPORTANT_DOCUMENT_TYPES = new Set([
  "prd", "technical_spec", "design_doc", "project_brief", "proposal",
  "budget_proposal", "architecture_decision", "contract", "sop",
]);

const WORKFLOW_ACTIONS: ReadonlySet<AutomationAction> = new Set([
  "assign_task",
  "create_task",
  "notify_agent",
  "send_message",
  "trigger_heartbeat",
  "create_approval",
  "update_task_status",
  "escalate_to_manager",
  "cross_department_notify",
  "schedule_meeting",
  "create_document",
  "auto_approve",
  "reassign_task",
  "run_task",
]);

interface WorkflowStepState {
  id: string;
  name: string;
  action: AutomationAction;
  configJson: string;
  assigneeDepartment: string | null;
  assigneeAgentId: string | null;
  requiresApproval: boolean;
  timeoutSec: number;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

export interface AutomationEventContext {
  companyId: string;
  taskId?: string;
  agentId?: string;
  runId?: string;
  projectId?: string;
  department?: string;
  previousStatus?: string;
  newStatus?: string;
  costUsd?: number;
}

interface AutomationDependencies {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  emitEvent: (event: DesktopEvent) => void;
  publishDomainChanged: () => void;
  notify: (options: NotificationOptions) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
  dispatchBrowserAction: (actionId: string, companyId: string) => Promise<void>;
  isQuitting: () => boolean;
}

interface RunFinishedEvent {
  status: RunStatus;
  summary: string | null;
  errorMessage: string | null;
  costUsd: number | null;
}

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

  function normalizeWorkflowSteps(raw: unknown): WorkflowStepState[] {
    if (!Array.isArray(raw)) {
      throw new Error("Workflow steps must be a JSON array.");
    }
    return raw.map((entry, index) => {
      const step = (entry ?? {}) as Record<string, unknown>;
      const rawAction = typeof step.action === "string" ? step.action : "send_message";
      if (!WORKFLOW_ACTIONS.has(rawAction as AutomationAction)) {
        throw new Error(`Workflow step ${index + 1} has unsupported action "${rawAction}".`);
      }
      return {
        id: typeof step.id === "string" && step.id ? step.id : `step-${index + 1}`,
        name: typeof step.name === "string" && step.name ? step.name : `Step ${index + 1}`,
        action: rawAction as AutomationAction,
        configJson: typeof step.configJson === "string" ? step.configJson : "{}",
        assigneeDepartment: typeof step.assigneeDepartment === "string" ? step.assigneeDepartment : null,
        assigneeAgentId: typeof step.assigneeAgentId === "string" ? step.assigneeAgentId : null,
        requiresApproval: step.requiresApproval === true,
        timeoutSec: typeof step.timeoutSec === "number" ? step.timeoutSec : 0,
        status: ["pending", "running", "completed", "failed", "skipped"].includes(String(step.status))
          ? (String(step.status) as WorkflowStepState["status"])
          : "pending",
      };
    });
  }

  function resolveWorkflowStepActor(step: WorkflowStepState, companyId: string): AgentRecord | null {
    if (step.assigneeAgentId) {
      const agent = db.getAgent(step.assigneeAgentId);
      if (agent.companyId !== companyId) {
        throw new Error(`Workflow step assignee ${step.assigneeAgentId} does not belong to company ${companyId}.`);
      }
      return agent;
    }

    if (step.assigneeDepartment) {
      const idleAgents = db.getIdleAgentsForDepartment(companyId, step.assigneeDepartment);
      if (idleAgents.length > 0) {
        return db.getAgent(idleAgents[0]!.id);
      }
    }

    const snapshot = db.listSnapshot();
    return snapshot.agents.find((agent) => agent.companyId === companyId && !agent.reportsTo && agent.status !== "terminated") ?? null;
  }

  function buildWorkflowActionContext(companyId: string, step: WorkflowStepState, actor: AgentRecord | null) {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(step.configJson) as Record<string, unknown>;
    } catch {
      throw new Error(`Workflow step "${step.name}" has invalid config JSON.`);
    }

    return {
      config,
      ctx: {
        companyId,
        agentId: actor?.id,
        department: actor?.department ?? step.assigneeDepartment ?? undefined,
        taskId: typeof config.taskId === "string" ? config.taskId : undefined,
        runId: typeof config.runId === "string" ? config.runId : undefined,
        projectId: typeof config.projectId === "string" ? config.projectId : undefined,
        newStatus: typeof config.status === "string" ? config.status : undefined,
      } satisfies AutomationEventContext,
    };
  }

  function matchesEventConfig(configJson: string, sourceDepartment: string | null, ctx: AutomationEventContext): boolean {
    if (sourceDepartment && ctx.department && sourceDepartment !== ctx.department) {
      return false;
    }
    try {
      const conditions = JSON.parse(configJson) as Record<string, unknown>;
      if (Object.keys(conditions).length === 0) return true;
      if (conditions.status && ctx.newStatus && conditions.status !== ctx.newStatus) return false;
      if (conditions.previousStatus && ctx.previousStatus && conditions.previousStatus !== ctx.previousStatus) return false;
      if (conditions.priority) {
        try {
          const task = ctx.taskId ? db.getTask(ctx.taskId) : null;
          if (task && task.priority !== conditions.priority) return false;
          // If task was deleted, skip this condition instead of rejecting the rule.
        } catch {
          // Entity missing — treat as condition not applicable, continue matching.
        }
      }
      if (typeof conditions.budgetThresholdPct === "number" && ctx.agentId) {
        try {
          const agent = db.getAgent(ctx.agentId);
          if (agent.budgetMonthlyUsd > 0) {
            const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
            if (utilization < (conditions.budgetThresholdPct as number) / 100) return false;
          }
          // If budget is 0 (unlimited), skip budget condition instead of rejecting.
        } catch {
          // Agent missing — treat as condition not applicable, continue matching.
        }
      }
      if (conditions.taskId && ctx.taskId && conditions.taskId !== ctx.taskId) return false;
      if (conditions.projectId && ctx.projectId && conditions.projectId !== ctx.projectId) return false;
      if (conditions.agentId && ctx.agentId && conditions.agentId !== ctx.agentId) return false;
      return true;
    } catch {
      return false;
    }
  }

  function matchesConditions(
    rule: { conditionsJson: string; sourceDepartment: string | null; targetDepartment: string | null },
    ctx: AutomationEventContext,
  ) {
    void rule.targetDepartment;
    return matchesEventConfig(rule.conditionsJson, rule.sourceDepartment, ctx);
  }

  function executeAutomationAction(
    rule: {
      id?: string;
      name?: string;
      action: string;
      actionConfigJson: string;
      targetDepartment: string | null;
      trigger?: string;
    },
    ctx: AutomationEventContext,
  ) {
    const config = (() => {
      try {
        return JSON.parse(rule.actionConfigJson) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();

    switch (rule.action as AutomationAction) {
      case "assign_task": {
        if (ctx.taskId) {
          const assignedId = db.autoAssignTask(ctx.taskId, ctx.companyId);
          if (assignedId) {
            wakeAgentIfPossible(assignedId, ctx.companyId, "assignment");
          }
        } else if (ctx.agentId) {
          const snapshot = db.listSnapshot();
          const unassigned = snapshot.tasks
            .filter((task) => task.companyId === ctx.companyId && !task.assigneeAgentId && ["backlog", "todo"].includes(task.status))
            .sort((a, b) => {
              const priorityScore = { critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>;
              return (priorityScore[b.priority] ?? 0) - (priorityScore[a.priority] ?? 0);
            });
          if (unassigned.length > 0) {
            const task = unassigned[0]!;
            db.saveTask({
              id: task.id,
              companyId: task.companyId,
              projectId: task.projectId,
              goalId: task.goalId,
              parentId: task.parentId,
              title: task.title,
              description: task.description,
              assigneeAgentId: ctx.agentId,
              workspaceId: task.workspaceId,
              priority: task.priority,
              status: "todo",
            });
            wakeAgentIfPossible(ctx.agentId, ctx.companyId, "assignment");
            logger.info(`[automation] Auto-assigned task "${task.title}" to idle agent ${ctx.agentId}`);
          }
        }
        break;
      }
      case "create_task": {
        const title = (config.title as string) ?? "[Auto] Task from automation rule";
        const description = (config.description as string) ?? "";
        const priority = (config.priority as string) ?? "medium";
        const assigneeAgentId = (config.assigneeAgentId as string) ?? null;
        const taskId = db.saveTask({
          companyId: ctx.companyId,
          projectId: ctx.projectId ?? (config.projectId as string) ?? null,
          title,
          description,
          assigneeAgentId,
          priority,
          status: assigneeAgentId ? "todo" : "backlog",
        });
        handleTaskCreated(taskId, ctx.companyId);
        logger.info(`[automation] Created task: ${title} (${taskId})`);
        break;
      }
      case "notify_agent":
      case "send_message": {
        const toAgentId = (config.toAgentId as string) ?? ctx.agentId ?? null;
        const fromAgentId = (config.fromAgentId as string) ?? ctx.agentId ?? toAgentId;
        if (!fromAgentId) break;
        const defaultChannel = toAgentId ? "direct" : "company";
        const requestedChannel = (config.channel as string) ?? defaultChannel;
        const channel = ["direct", "department", "company", "project", "incident"].includes(requestedChannel)
          ? requestedChannel
          : defaultChannel;
        let channelTargetId: string | null = (config.channelTargetId as string) ?? (config.department as string) ?? ctx.department ?? null;
        if (channel === "department" && !channelTargetId && fromAgentId) {
          try {
            const sender = db.getAgent(fromAgentId);
            channelTargetId = sender.department ?? null;
          } catch {
            channelTargetId = null;
          }
        }
        const dispatchResult = dispatchAgentMessage(
          {
            db,
            emitEvent,
            publishDomainChanged,
            wakeAgentIfPossible,
          },
          {
            companyId: ctx.companyId,
            fromAgentId,
            toAgentId: channel === "direct" ? toAgentId : null,
            channel: channel as "direct" | "department" | "company" | "project" | "incident",
            channelTargetId,
            subject: (config.subject as string) ?? "Automation notification",
            body: (config.body as string) ?? `Automation rule triggered for task ${ctx.taskId ?? "n/a"}`,
            priority: (config.priority as "urgent" | "normal" | "low") ?? "normal",
          },
          "message",
        );
        if (!dispatchResult.ok) {
          logger.warn(
            `[automation] Failed to dispatch message for rule ${rule.name} (${rule.id}): ${dispatchResult.error.code} ${dispatchResult.error.message}`,
          );
        }
        break;
      }
      case "trigger_heartbeat": {
        let targetAgentId = (config.agentId as string) ?? null;
        if (!targetAgentId && ctx.agentId) {
          const triggerType = rule.trigger ?? "";
          if (triggerType === "run_completed" || triggerType === "run_failed") {
            const manager = db.getManagerForAgent(ctx.agentId);
            targetAgentId = manager?.id ?? ctx.agentId;
          } else {
            targetAgentId = ctx.agentId;
          }
        }
        if (targetAgentId) {
          // Derive a descriptive wake trigger from the automation context
          const triggerType = rule.trigger ?? "";
          const wakeTrigger =
            triggerType === "task_status_changed" && ctx.previousStatus === "in_review" ? "comment"
              : triggerType === "run_completed" ? "subtask_completed"
                : triggerType === "run_failed" ? "report_failed"
                  : triggerType === "hire_approved" ? "assignment"
                    : triggerType === "agent_idle" ? "timer"
                      : "manual";
          wakeAgentIfPossible(targetAgentId, ctx.companyId, wakeTrigger);
        }
        break;
      }
      case "create_approval": {
        const approvalType = (config.approvalType as string) ?? "document_review";
        db.requestApproval({
          companyId: ctx.companyId,
          relatedTaskId: ctx.taskId ?? null,
          requestedByAgentId: ctx.agentId ?? null,
          type: approvalType,
          payloadSummary: (config.summary as string) ?? "Auto-generated approval request",
          impactSummary: (config.impact as string) ?? "Triggered by automation rule",
        });
        break;
      }
      case "update_task_status": {
        if (!ctx.taskId) break;
        const newStatus = (config.status as string) ?? "todo";
        const previousTask = db.getTask(ctx.taskId);
        db.advanceTaskStatus(ctx.taskId, newStatus, "Status changed by automation rule");
        publishDomainChanged();
        if (previousTask.status !== newStatus && rule.trigger !== "task_status_changed") {
          handleTaskStatusChange(ctx.taskId, ctx.companyId, previousTask.status, newStatus);
        }
        break;
      }
      case "escalate_to_manager": {
        const targetAgentId = ctx.agentId;
        if (!targetAgentId) break;
        let agentName = "an agent";
        try {
          agentName = db.getAgent(targetAgentId).name;
        } catch {
          // Fall back to the generic label when the agent was deleted mid-flight.
        }
        let taskTitle = ctx.taskId ?? "unknown";
        try {
          if (ctx.taskId) taskTitle = db.getTask(ctx.taskId).title;
        } catch {
          // Keep the fallback title when the task no longer exists.
        }
        const manager = db.getManagerForAgent(targetAgentId);
        const escalationBody = (config.body as string) ?? `Task "${taskTitle}" needs your attention. ${agentName} has flagged this as requiring manager intervention.`;
        // Pick the most descriptive wake trigger based on the originating event
        const wakeTrigger = ctx.newStatus === "in_review"
          ? "subtask_completed"
          : ctx.newStatus === "blocked"
            ? "report_blocked"
            : rule.trigger === "run_completed"
              ? "subtask_completed"
              : rule.trigger === "run_failed"
                ? "report_failed"
                : "report_blocked";
        if (manager) {
          const escalationResult = dispatchAgentMessage(
            {
              db,
              emitEvent,
              publishDomainChanged,
              wakeAgentIfPossible,
            },
            {
              companyId: ctx.companyId,
              fromAgentId: targetAgentId,
              toAgentId: manager.id,
              channel: "direct",
              subject: `Escalation from ${agentName}: ${taskTitle}`,
              body: escalationBody,
              priority: "urgent",
            },
            wakeTrigger,
          );
          if (!escalationResult.ok) {
            logger.warn(
              `[automation] Failed to escalate "${taskTitle}" to manager: ${escalationResult.error.code} ${escalationResult.error.message}`,
            );
          }
        } else {
          // No manager found — agent is likely the CEO or top-level.
          // Post as company-wide message so the board and other leaders see it.
          const escalationResult = dispatchAgentMessage(
            {
              db,
              emitEvent,
              publishDomainChanged,
              wakeAgentIfPossible,
            },
            {
              companyId: ctx.companyId,
              fromAgentId: targetAgentId,
              toAgentId: null,
              channel: "company",
              subject: `Escalation: ${taskTitle}`,
              body: escalationBody,
              priority: "urgent",
            },
            wakeTrigger,
          );
          if (!escalationResult.ok) {
            logger.warn(
              `[automation] Failed to escalate "${taskTitle}" to company channel: ${escalationResult.error.code} ${escalationResult.error.message}`,
            );
          }
        }
        break;
      }
      case "cross_department_notify": {
        const targetDepartment = rule.targetDepartment ?? (config.department as string);
        if (!targetDepartment) break;
        const departmentAgents = db.getIdleAgentsForDepartment(ctx.companyId, targetDepartment);
        const senderAgentId = ctx.agentId ?? departmentAgents[0]?.id;
        if (senderAgentId) {
          const dispatchResult = dispatchAgentMessage(
            {
              db,
              emitEvent,
              publishDomainChanged,
              wakeAgentIfPossible,
            },
            {
              companyId: ctx.companyId,
              fromAgentId: senderAgentId,
              toAgentId: null,
              channel: "department",
              channelTargetId: targetDepartment,
              subject: (config.subject as string) ?? "Cross-department notification",
              body: (config.body as string) ?? "Automation triggered a cross-department alert.",
              priority: "normal",
            },
            "message",
          );
          if (!dispatchResult.ok) {
            logger.warn(
              `[automation] Failed cross-department notification for ${targetDepartment}: ${dispatchResult.error.code} ${dispatchResult.error.message}`,
            );
          }
        }
        break;
      }
      case "schedule_meeting": {
        const meetingType = (config.meetingType as string) ?? "department_sync";
        const title = (config.title as string) ?? "Auto-scheduled meeting";
        db.saveMeeting({
          companyId: ctx.companyId,
          type: meetingType,
          title,
          organizerAgentId: ctx.agentId ?? null,
          participantAgentIds: (config.participantAgentIds as string) ?? "[]",
          scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
          durationMinutes: (config.durationMinutes as number) ?? 30,
        });
        break;
      }
      case "create_document": {
        const documentType = (config.documentType as string) ?? "status_report";
        const title = (config.title as string) ?? "Auto-generated document";
        db.saveDocument({
          companyId: ctx.companyId,
          type: documentType,
          title,
          content: (config.content as string) ?? "",
          authorAgentId: ctx.agentId ?? null,
          projectId: ctx.projectId ?? null,
        });
        break;
      }
      case "auto_approve": {
        const snapshot = db.listSnapshot();
        const pendingApprovals = snapshot.approvals.filter(
          (approval) => approval.companyId === ctx.companyId && approval.state === "pending",
        );
        for (const approval of pendingApprovals.slice(0, 5)) {
          db.decideApproval({
            companyId: ctx.companyId,
            approvalId: approval.id,
            state: "approved",
            decisionNote: "Auto-approved by automation rule.",
          });
          handleApprovalResolved(approval.id, ctx.companyId, "approved");
        }
        break;
      }
      case "reassign_task": {
        if (!ctx.taskId) break;
        const newAssignee = db.autoAssignTask(ctx.taskId, ctx.companyId);
        if (newAssignee) {
          wakeAgentIfPossible(newAssignee, ctx.companyId, "assignment");
        }
        break;
      }
      case "run_task": {
        const targetTaskId = (config.taskId as string) ?? ctx.taskId;
        if (!targetTaskId) break;
        const task = db.getTask(targetTaskId);
        if (!task.assigneeAgentId) break;
        wakeAgentIfPossible(task.assigneeAgentId, ctx.companyId, "assignment");
        break;
      }
      default:
        throw new Error(`Unknown automation action: ${rule.action}`);
    }
  }

  function evaluateAutomationRules(trigger: string, ctx: AutomationEventContext) {
    try {
      const rules = db.listActiveAutomationRules(ctx.companyId, trigger);
      for (const rule of rules) {
        if (!matchesConditions(rule, ctx)) continue;
        const executionKey = [
          rule.id,
          trigger,
          ctx.companyId,
          ctx.taskId ?? "-",
          ctx.agentId ?? "-",
          ctx.runId ?? "-",
          ctx.previousStatus ?? "-",
          ctx.newStatus ?? "-",
        ].join(":");
        if (activeAutomationExecutions.has(executionKey)) {
          logger.warn(`[automation] Skipping re-entrant execution for rule "${rule.name}" (${executionKey})`);
          continue;
        }
        activeAutomationExecutions.add(executionKey);
        try {
          executeAutomationAction(rule, ctx);
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
        if (!matchesEventConfig(workflow.triggerConfigJson, null, ctx)) continue;
        const executionKey = [
          workflow.id,
          trigger,
          ctx.companyId,
          ctx.taskId ?? "-",
          ctx.agentId ?? "-",
          ctx.runId ?? "-",
          ctx.previousStatus ?? "-",
          ctx.newStatus ?? "-",
        ].join(":");
        if (activeWorkflowTriggerExecutions.has(executionKey)) {
          logger.warn(`[workflow] Skipping re-entrant trigger for workflow "${workflow.name}" (${executionKey})`);
          continue;
        }
        activeWorkflowTriggerExecutions.add(executionKey);
        void runWorkflowPipeline(workflow.id, ctx.companyId)
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

  async function runWorkflowPipeline(workflowId: string, companyId: string) {
    const workflow = db.getWorkflowRecord(workflowId, companyId);
    if (!workflow) {
      throw new Error("Workflow not found.");
    }
    const parsedSteps = normalizeWorkflowSteps(JSON.parse(workflow.stepsJson || "[]"));
    if (parsedSteps.some((step) => step.status === "running")) {
      throw new Error("Workflow is already running.");
    }
    if (parsedSteps.length === 0) {
      throw new Error("Workflow has no steps.");
    }

    const resumeFrom = workflow.status === "paused" ? workflow.currentStepIndex : 0;
    const steps: WorkflowStepState[] = parsedSteps.map((step, index) => {
      if (workflow.status !== "paused") {
        return { ...step, status: index < resumeFrom ? "completed" : "pending" };
      }
      return step;
    });

    db.updateWorkflowExecution({
      id: workflowId,
      companyId,
      status: "active",
      currentStepIndex: resumeFrom,
      stepsJson: JSON.stringify(steps),
      incrementRunCount: workflow.status !== "paused",
      lastRunAt: new Date().toISOString(),
    });
    publishDomainChanged();

    for (let index = resumeFrom; index < steps.length; index += 1) {
      const step = steps[index]!;
      step.status = "running";
      db.updateWorkflowExecution({
        id: workflowId,
        companyId,
        status: "active",
        currentStepIndex: index,
        stepsJson: JSON.stringify(steps),
        lastRunAt: new Date().toISOString(),
      });
      publishDomainChanged();

      const actor = resolveWorkflowStepActor(step, companyId);
      const { config, ctx } = buildWorkflowActionContext(companyId, step, actor);

      if (step.requiresApproval) {
        const approvalId = db.requestApproval({
          companyId,
          requestedByAgentId: actor?.id ?? null,
          relatedTaskId: ctx.taskId ?? null,
          type: "dangerous_command",
          payloadSummary: `Workflow approval required: ${workflow.name} / ${step.name}`,
          impactSummary: `Workflow step "${step.name}" requires board approval before ${step.action}.`,
          payloadJson: JSON.stringify({ workflowId, stepId: step.id, stepName: step.name }),
        });
        step.status = "pending";
        db.updateWorkflowExecution({
          id: workflowId,
          companyId,
          status: "paused",
          currentStepIndex: index,
          stepsJson: JSON.stringify(steps),
          lastRunAt: new Date().toISOString(),
        });
        db.addActivity({
          companyId,
          actor: actor?.id ?? "system",
          action: "workflow.paused_for_approval",
          entityType: "workflow",
          entityId: workflowId,
          detail: `Paused on step "${step.name}" with approval ${approvalId}.`,
        });
        publishDomainChanged();
        return;
      }

      try {
        executeAutomationAction({
          action: step.action,
          actionConfigJson: JSON.stringify(config),
          targetDepartment: step.assigneeDepartment,
          trigger: "workflow_step",
        }, ctx);
        step.status = "completed";
        db.addActivity({
          companyId,
          actor: actor?.id ?? "system",
          action: "workflow.step_completed",
          entityType: "workflow",
          entityId: workflowId,
          detail: step.name,
        });
        const isLastStep = index === steps.length - 1;
        const completionStatus = isLastStep ? "completed" : "active";
        db.updateWorkflowExecution({
          id: workflowId,
          companyId,
          status: completionStatus,
          currentStepIndex: index + 1,
          stepsJson: JSON.stringify(steps),
          lastRunAt: new Date().toISOString(),
        });
        publishDomainChanged();
      } catch (error) {
        step.status = "failed";
        db.updateWorkflowExecution({
          id: workflowId,
          companyId,
          status: "failed",
          currentStepIndex: index,
          stepsJson: JSON.stringify(steps),
          lastRunAt: new Date().toISOString(),
        });
        db.addActivity({
          companyId,
          actor: actor?.id ?? "system",
          action: "workflow.step_failed",
          entityType: "workflow",
          entityId: workflowId,
          detail: `${step.name}: ${error instanceof Error ? error.message : String(error)}`,
        });
        publishDomainChanged();
        throw error;
      }
    }
  }

  function checkRunProducedDeliverable(runId: string, companyId: string, taskId: string): boolean {
    // Check for knowledge entries created during this run
    try {
      const recentKnowledge = db.queryAll<{ id: string }>(
        "select id from knowledge_entries where company_id = ? and created_at >= (select started_at from runs where id = ?) limit 1",
        companyId, runId,
      );
      if (recentKnowledge.length > 0) return true;
    } catch { /* table may not exist */ }

    // Check for documents created during this run
    try {
      const recentDocs = db.queryAll<{ id: string }>(
        "select id from documents where company_id = ? and created_at >= (select started_at from runs where id = ?) limit 1",
        companyId, runId,
      );
      if (recentDocs.length > 0) return true;
    } catch { /* table may not exist */ }

    // Check for substantial comments on the task (agent may have written findings as comments)
    try {
      const recentComments = db.queryAll<{ body: string }>(
        "select body from comments where task_id = ? and created_at >= (select started_at from runs where id = ?) and length(body) > 100",
        taskId, runId,
      );
      if (recentComments.length > 0) return true;
    } catch { /* table may not exist */ }

    return false;
  }

  /** Returns important documents created during this run (matching IMPORTANT_DOCUMENT_TYPES). */
  function findImportantDocsForRun(runId: string, companyId: string): Array<{ id: string; type: string; title: string }> {
    try {
      const placeholders = [...IMPORTANT_DOCUMENT_TYPES].map(() => "?").join(", ");
      return db.queryAll<{ id: string; type: string; title: string }>(
        `select id, type, title from documents where company_id = ? and type in (${placeholders}) and created_at >= (select started_at from runs where id = ?)`,
        companyId, ...IMPORTANT_DOCUMENT_TYPES, runId,
      );
    } catch { return []; }
  }

  /** Creates a deliverable_review approval and fires OS notification. */
  function createDeliverableReviewApproval(
    companyId: string,
    taskId: string,
    agentId: string,
    docs: Array<{ id: string; type: string; title: string }>,
    reviewerNote?: string,
  ): string {
    const docTitles = docs.map((d) => d.title).join(", ");
    const approvalId = db.requestApproval({
      companyId,
      relatedTaskId: taskId,
      requestedByAgentId: agentId,
      type: "deliverable_review",
      payloadSummary: `Review deliverable: ${docTitles}`.slice(0, 280),
      impactSummary: reviewerNote ?? "Agent completed work with important deliverables. Awaiting your final review.",
      payloadJson: JSON.stringify({ documentIds: docs.map((d) => d.id), documents: docs }),
    });
    db.setTaskRequiresUserReview(taskId, false);
    // Pause the producing agent's heartbeat until the user reviews
    try {
      const agent = db.getAgent(agentId);
      if (agent.heartbeatEnabled) {
        db.setHeartbeat(agentId, false, agent.heartbeatIntervalSec || 120);
        logger.info(`[deliverable-review] Paused heartbeat for ${agent.name} — awaiting user review.`);
      }
    } catch { /* best effort */ }
    try {
      notify({
        title: "Deliverable Ready for Review",
        body: `${docTitles}`.slice(0, 200),
        urgency: "informational",
        navigation: { section: "approvals", entityId: approvalId },
        batchKey: "deliverable_review",
      });
    } catch { /* best effort */ }
    publishDomainChanged();
    return approvalId;
  }

  function processRunCompletion(run: RunRecord, event: RunFinishedEvent) {
    if (isQuitting()) return;
    let task: ReturnType<typeof db.getTask> | null = null;
    try {
      task = db.getTask(run.taskId);
    } catch {
      return;
    }
    if (!task) return;

    const isSuccess = event.status === "succeeded";
    const isFailed = event.status === "failed" || event.status === "timed_out";

    let effectiveStatus = task.status;

    if (isSuccess && effectiveStatus === "in_progress") {
      // Check if non-code task produced a deliverable before auto-advancing
      const taskType = ((task as unknown as Record<string, unknown>).task_type as string) ?? "general";
      const needsDeliverable = taskType === "research" || taskType === "content";

      if (needsDeliverable) {
        const hasDeliverable = checkRunProducedDeliverable(run.id, run.companyId, task.id);
        if (!hasDeliverable) {
          // Don't auto-advance -- flag for manager review
          db.advanceTaskStatus(task.id, "in_progress",
            `${taskType} task run completed but no deliverable artifact was detected. Flagging for manager review.`);
          handleTaskStatusChange(task.id, run.companyId, "in_progress", "in_progress");
          // Wake manager for review
          try {
            const agent = db.getAgent(run.agentId);
            const chain = db.getChainOfCommand(agent.id);
            if (chain.length > 0) {
              wakeAgentIfPossible(chain[0].id, run.companyId, "review_needed");
            }
          } catch { /* best effort */ }
          publishDomainChanged();
          // Skip the normal in_review advance
        } else {
          db.advanceTaskStatus(task.id, "in_review", "Run completed with deliverable. Awaiting review.");
          handleTaskStatusChange(task.id, run.companyId, "in_progress", "in_review");
          effectiveStatus = "in_review";
          // Check if deliverable review gate should activate
          try {
            const company = db.listSnapshot().companies.find((c) => c.id === run.companyId);
            if (company?.reviewDeliverables) {
              const importantDocs = findImportantDocsForRun(run.id, run.companyId);
              if (importantDocs.length > 0) {
                db.setTaskRequiresUserReview(task.id, true);
                const agent = db.getAgent(run.agentId);
                // Pause heartbeat immediately — agent should not run while deliverable awaits review
                if (agent.heartbeatEnabled) {
                  db.setHeartbeat(agent.id, false, agent.heartbeatIntervalSec || 120);
                  logger.info(`[deliverable-review] Paused heartbeat for ${agent.name} — deliverable flagged for review.`);
                }
                // If agent has no manager (is CEO), create approval immediately
                const chain = db.getChainOfCommand(agent.id);
                if (chain.length === 0) {
                  createDeliverableReviewApproval(run.companyId, task.id, run.agentId, importantDocs);
                }
              }
            }
          } catch { /* deliverable review gate is best-effort */ }
          publishDomainChanged();
        }
      } else {
        // Code/management/general tasks advance normally
        db.advanceTaskStatus(task.id, "in_review", "Run completed successfully. Awaiting review.");
        handleTaskStatusChange(task.id, run.companyId, "in_progress", "in_review");
        effectiveStatus = "in_review";
        // Check if deliverable review gate should activate for code/general tasks too
        try {
          const company = db.listSnapshot().companies.find((c) => c.id === run.companyId);
          if (company?.reviewDeliverables) {
            const importantDocs = findImportantDocsForRun(run.id, run.companyId);
            if (importantDocs.length > 0) {
              db.setTaskRequiresUserReview(task.id, true);
              const agent = db.getAgent(run.agentId);
              if (agent.heartbeatEnabled) {
                db.setHeartbeat(agent.id, false, agent.heartbeatIntervalSec || 120);
                logger.info(`[deliverable-review] Paused heartbeat for ${agent.name} — deliverable flagged for review.`);
              }
              const chain = db.getChainOfCommand(agent.id);
              if (chain.length === 0) {
                createDeliverableReviewApproval(run.companyId, task.id, run.agentId, importantDocs);
              }
            }
          }
        } catch { /* deliverable review gate is best-effort */ }
        publishDomainChanged();
      }
    }

    if (isSuccess && task.title.startsWith("[Heartbeat]") && effectiveStatus !== "done") {
      db.advanceTaskStatus(task.id, "done", "Heartbeat check completed.");
      handleTaskStatusChange(task.id, run.companyId, effectiveStatus, "done");
    }

    const automationContext: AutomationEventContext = {
      companyId: run.companyId,
      taskId: run.taskId,
      agentId: run.agentId,
      runId: run.id,
      costUsd: event.costUsd ?? undefined,
    };
    try {
      const agent = db.getAgent(run.agentId);
      automationContext.department = agent.department ?? undefined;
    } catch {
      // Agent can disappear after a run completes; keep the context without department.
    }

    if (isSuccess) {
      dispatchAutomation("run_completed", automationContext);
      if (task.parentId) {
        try {
          const siblings = db.listChildTasks(task.parentId, run.companyId);
          const allSiblingsDoneOrReview = siblings.every((entry) => entry.status === "done" || entry.status === "in_review");
          if (allSiblingsDoneOrReview) {
            const parent = db.getTask(task.parentId);
            if (parent.assigneeAgentId) {
              wakeAgentIfPossible(parent.assigneeAgentId, run.companyId, "subtask_completed");
            } else {
              const assignedId = db.autoAssignTask(parent.id, run.companyId);
              if (assignedId) {
                wakeAgentIfPossible(assignedId, run.companyId, "subtask_completed");
              }
            }
          }
        } catch {
          // Parent task may have been deleted or reassigned during cascade evaluation.
        }
      }
    }

    if (isFailed) {
      dispatchAutomation("run_failed", automationContext);
    }

    if (event.costUsd && event.costUsd > 0) {
      try {
        const agent = db.getAgent(run.agentId);
        if (agent.budgetMonthlyUsd > 0) {
          const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
          if (utilization >= 0.8) {
            dispatchAutomation("budget_threshold", {
              ...automationContext,
              agentId: agent.id,
            });
            // Fire OS notification for budget threshold warning
            const pct = Math.round(utilization * 100);
            notify({
              title: "Budget Warning",
              body: `${agent.name} has used ${pct}% of monthly budget`,
              urgency: "informational",
              navigation: { section: "costs" },
              batchKey: "budget_alerts",
            });
            if (utilization >= 1.0) {
              // Fire OS notification for budget exhaustion (agent auto-paused by database)
              notify({
                title: "Budget Exhausted",
                body: `${agent.name} has reached 100% of monthly budget and is paused`,
                urgency: "critical",
                navigation: { section: "costs" },
              });
            }
          }
        }
      } catch {
        // Budget follow-up is best-effort; do not fail run completion if the agent disappeared.
      }
    }
  }

  function handleApprovalResolved(approvalId: string, companyId: string, decision: string) {
    if (isQuitting()) return;
    const snapshot = db.listSnapshot();
    const approval = snapshot.approvals.find((entry) => entry.id === approvalId);
    if (!approval) return;

    dispatchAutomation("approval_resolved", {
      companyId,
      agentId: approval.requestedByAgentId ?? undefined,
      taskId: approval.relatedTaskId ?? undefined,
    });

    if (approval.type === "hire_agent" && decision === "approved" && approval.relatedAgentId) {
      try {
        const agent = db.getAgent(approval.relatedAgentId);
        if (agent.status === "idle") {
          db.addActivity({
            companyId,
            actor: "system",
            action: "agent.hired",
            entityType: "agent",
            entityId: agent.id,
            detail: `${agent.name} hire approved and activated.`,
          });
          dispatchAutomation("hire_approved", {
            companyId,
            agentId: agent.id,
          });
          wakeAgentIfPossible(agent.id, companyId, "assignment");
          publishDomainChanged();
          notify({
            title: "Agent Hired",
            body: `${agent.name} joined as ${agent.role}`,
            urgency: "informational",
            navigation: { section: "orgchart", entityId: agent.id },
            batchKey: "agent_hired",
          });
        }
      } catch {
        // Hire follow-up is best-effort; approval state is already committed in storage.
      }
    }

    if (approval.type === "deliverable_review" && approval.relatedTaskId) {
      try {
        const task = db.getTask(approval.relatedTaskId);
        // Re-enable heartbeat for the producing agent now that the user has decided
        if (task.assigneeAgentId) {
          try {
            const agent = db.getAgent(task.assigneeAgentId);
            if (!agent.heartbeatEnabled) {
              db.setHeartbeat(task.assigneeAgentId, true, agent.heartbeatIntervalSec || 120);
              logger.info(`[deliverable-review] Resumed heartbeat for ${agent.name} after user ${decision}.`);
            }
          } catch { /* best effort */ }
        }
        if (decision === "approved") {
          db.advanceTaskStatus(task.id, "done", "Board approved deliverable.");
          handleTaskStatusChange(task.id, companyId, task.status, "done");
          db.addActivity({ companyId, actor: "board", action: "deliverable.approved", entityType: "task", entityId: task.id, detail: approval.decisionNote || "Deliverable approved by board." });
          publishDomainChanged();
        } else if (decision === "rejected") {
          db.advanceTaskStatus(task.id, "in_progress", `Board rejected deliverable: ${approval.decisionNote || "No reason given."}`);
          handleTaskStatusChange(task.id, companyId, task.status, "in_progress");
          if (task.assigneeAgentId) {
            wakeAgentIfPossible(task.assigneeAgentId, companyId, "revision_needed");
          }
          publishDomainChanged();
        } else if (decision === "revision_requested") {
          if (task.assigneeAgentId) {
            wakeAgentIfPossible(task.assigneeAgentId, companyId, "revision_needed");
          }
          publishDomainChanged();
        }
      } catch {
        // Deliverable review follow-up is best-effort.
      }
    }

    const browserAction = db.getBrowserActionByApprovalId(approvalId, companyId);
    if (browserAction) {
      if (decision === "approved") {
        db.updateBrowserAction(browserAction.id, {
          status: "queued",
          resultSummary: "Approval granted. Dispatching browser action.",
          errorMessage: null,
        });
        publishDomainChanged();
        void dispatchBrowserAction(browserAction.id, companyId).catch((error) => {
          logger.error(`[browser] Failed to dispatch approved browser action ${browserAction.id}: ${error instanceof Error ? error.message : String(error)}`);
        });
      } else if (decision === "rejected") {
        db.updateBrowserAction(browserAction.id, {
          status: "cancelled",
          resultSummary: "Browser action was rejected during approval.",
          errorMessage: "Approval rejected by board.",
          finishedAt: new Date().toISOString(),
        });
        publishDomainChanged();
      } else if (decision === "revision_requested") {
        db.updateBrowserAction(browserAction.id, {
          status: "approval_required",
          resultSummary: "Board requested revisions before execution.",
          errorMessage: "Approval requires revisions before the browser action can run.",
        });
        publishDomainChanged();
      }
    }

    if (approval.type === "social_post" && decision === "approved" && approval.payloadJson) {
      try {
        const draft = JSON.parse(approval.payloadJson) as {
          socialAccountId: string;
          platform: string;
          content: string;
          mediaUrls: string[];
          scheduledAt: string | null;
        };

        const dispatchSocialAction = () => {
          const actionId = db.saveBrowserAction({
            companyId: approval.companyId,
            socialAccountId: draft.socialAccountId,
            agentId: approval.requestedByAgentId ?? "",
            actionType: "post",
            payloadJson: JSON.stringify({ content: draft.content, mediaUrls: draft.mediaUrls, scheduledAt: draft.scheduledAt }),
            status: "queued",
            approvalId: approval.id,
          });
          publishDomainChanged();
          void dispatchBrowserAction(actionId, approval.companyId).catch((error) => {
            logger.error(`[automation] Failed to dispatch approved social post ${actionId}: ${error instanceof Error ? error.message : String(error)}`);
          });
        };

        if (draft.scheduledAt) {
          const delay = new Date(draft.scheduledAt).getTime() - Date.now();
          if (delay > 0) {
            const timer = setTimeout(() => {
              pendingScheduledTimers.delete(timer);
              if (isQuitting()) return;
              dispatchSocialAction();
            }, delay);
            pendingScheduledTimers.add(timer);
          } else {
            dispatchSocialAction();
          }
        } else {
          dispatchSocialAction();
        }
      } catch (err) {
        logger.error("[automation] Failed to dispatch approved social post:", err);
      }
    }

    if (approval.payloadJson) {
      try {
        const payload = JSON.parse(approval.payloadJson) as { workflowId?: string; stepId?: string };
        if (payload.workflowId && payload.stepId) {
          const workflow = db.getWorkflowRecord(payload.workflowId, companyId);
          if (workflow) {
            const steps = normalizeWorkflowSteps(JSON.parse(workflow.stepsJson || "[]"));
            const stepIndex = steps.findIndex((step) => step.id === payload.stepId);
            if (stepIndex >= 0) {
              if (decision === "approved") {
                steps[stepIndex]!.status = "pending";
                db.updateWorkflowExecution({
                  id: workflow.id,
                  companyId,
                  status: "paused",
                  currentStepIndex: stepIndex,
                  stepsJson: JSON.stringify(steps),
                  lastRunAt: workflow.lastRunAt,
                });
                publishDomainChanged();
                void runWorkflowPipeline(workflow.id, companyId).catch((error) => {
                  logger.error(`[workflow] Failed to resume workflow ${workflow.id} after approval ${approvalId}: ${error instanceof Error ? error.message : String(error)}`);
                });
              } else {
                steps[stepIndex]!.status = decision === "revision_requested" ? "pending" : "failed";
                db.updateWorkflowExecution({
                  id: workflow.id,
                  companyId,
                  status: decision === "revision_requested" ? "paused" : "failed",
                  currentStepIndex: stepIndex,
                  stepsJson: JSON.stringify(steps),
                  lastRunAt: workflow.lastRunAt,
                });
                publishDomainChanged();
              }
            }
          }
        }
      } catch {
        // Non-workflow approvals may use payloadJson for unrelated metadata.
      }
    }

    if (approval.requestedByAgentId) {
      wakeAgentIfPossible(approval.requestedByAgentId, companyId, "approval_resolved");
    }
  }

  function handleTaskStatusChange(taskId: string, companyId: string, previousStatus: string, newStatus: string) {
    if (isQuitting()) return;
    if (previousStatus === newStatus) return;

    let task: ReturnType<typeof db.getTask> | null = null;
    try {
      task = db.getTask(taskId);
    } catch {
      return;
    }
    if (!task) return;

    db.addActivity({
      companyId,
      actor: task.assigneeAgentId ?? "board",
      action: "task.status_changed",
      entityType: "task",
      entityId: taskId,
      detail: `${previousStatus} → ${newStatus}`,
    });

    const context: AutomationEventContext = {
      companyId,
      taskId,
      agentId: task.assigneeAgentId ?? undefined,
      previousStatus,
      newStatus,
    };
    try {
      if (task.assigneeAgentId) {
        const agent = db.getAgent(task.assigneeAgentId);
        context.department = agent.department ?? undefined;
      }
    } catch {
      // Agent may have been deleted after the task update; keep the transition without department context.
    }

    dispatchAutomation("task_status_changed", context);

    if (newStatus === "blocked") {
      dispatchAutomation("task_blocked", context);
      if (task.assigneeAgentId) {
        const manager = db.getManagerForAgent(task.assigneeAgentId);
        if (manager) {
          wakeAgentIfPossible(manager.id, companyId, "report_blocked");
        }
      }
    }

    if (newStatus === "done" && task.parentId) {
      try {
        const siblings = db.listChildTasks(task.parentId, companyId);
        const allDone = siblings.every((entry) => entry.id === taskId ? true : entry.status === "done");
        if (allDone) {
          const parent = db.getTask(task.parentId);
          if (parent.assigneeAgentId) {
            wakeAgentIfPossible(parent.assigneeAgentId, companyId, "subtask_completed");
          } else {
            const assignedId = db.autoAssignTask(parent.id, companyId);
            if (assignedId) {
              wakeAgentIfPossible(assignedId, companyId, "subtask_completed");
            }
          }
        }
      } catch {
        // Parent task may have been deleted or reassigned during completion cascade evaluation.
      }
    }
  }

  function handleTaskCreated(taskId: string, companyId: string) {
    if (isQuitting()) return;
    let task: ReturnType<typeof db.getTask> | null = null;
    try {
      task = db.getTask(taskId);
    } catch {
      return;
    }
    if (!task) return;

    dispatchAutomation("task_created", {
      companyId,
      taskId,
      agentId: task.assigneeAgentId ?? undefined,
    });

    if (!task.assigneeAgentId) {
      const assignedId = db.autoAssignTask(taskId, companyId);
      if (assignedId) {
        wakeAgentIfPossible(assignedId, companyId, "assignment");
      }
    } else {
      wakeAgentIfPossible(task.assigneeAgentId, companyId, "assignment");
    }
  }

  function destroy() {
    for (const timer of pendingScheduledTimers) {
      clearTimeout(timer);
    }
    pendingScheduledTimers.clear();
  }

  return {
    runWorkflowPipeline,
    dispatchAutomation,
    processRunCompletion,
    handleApprovalResolved,
    handleTaskStatusChange,
    handleTaskCreated,
    destroy,
  };
}
