import type { AppDatabase } from "../database";
import type { AutomationAction, DesktopEvent } from "@shared/types";
import { dispatchAgentMessage } from "../messaging/dispatch";
import { validateTaskCreation } from "../task-quality-gates";
import type { AutomationEventContext } from "./types";
import { parseActionConfig, type AutomationActionConfigMap } from "./automation-action-schemas";

// Map trigger type → default wake trigger when automation fires a heartbeat.
const HEARTBEAT_WAKE_TRIGGER_MAP: Record<string, string> = {
  run_completed: "subtask_completed",
  run_failed: "report_failed",
  hire_approved: "assignment",
  agent_idle: "timer",
};

function deriveHeartbeatWakeTrigger(triggerType: string, previousStatus: string | null): string {
  if (triggerType === "task_status_changed" && previousStatus === "in_review") return "comment";
  return HEARTBEAT_WAKE_TRIGGER_MAP[triggerType] ?? "manual";
}

// Map the run/state combination → wake trigger for escalation to manager.
// Status-based mapping takes precedence; rule-trigger mapping is the fallback.
const ESCALATION_STATUS_TRIGGER_MAP: Record<string, string> = {
  in_review: "subtask_completed",
  blocked: "report_blocked",
};
const ESCALATION_RULE_TRIGGER_MAP: Record<string, string> = {
  run_completed: "subtask_completed",
  run_failed: "report_failed",
};
function deriveEscalationWakeTrigger(newStatus: string | null, ruleTrigger: string | null): string {
  if (newStatus && ESCALATION_STATUS_TRIGGER_MAP[newStatus]) return ESCALATION_STATUS_TRIGGER_MAP[newStatus];
  if (ruleTrigger && ESCALATION_RULE_TRIGGER_MAP[ruleTrigger]) return ESCALATION_RULE_TRIGGER_MAP[ruleTrigger];
  return "report_blocked";
}

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

export function executeAutomationAction(
  deps: ActionDeps,
  callbacks: ActionCallbacks,
  rule: {
    id?: string;
    name?: string;
    action: string;
    actionConfigJson: string;
    targetDepartment: string | null;
    trigger?: string;
  },
  ctx: AutomationEventContext,
): void {
  const { db, logger, emitEvent, publishDomainChanged, wakeAgentIfPossible } = deps;
  const { handleTaskCreated, handleApprovalResolved, handleTaskStatusChange } = callbacks;

  const action = rule.action as AutomationAction;
  // Validate config against the per-action schema; schema failures surface
  // as thrown errors so the caller (evaluateAutomationRules) records + logs.
  const config = parseActionConfig(action, rule.actionConfigJson) as AutomationActionConfigMap[typeof action] & Record<string, unknown>;

  switch (action) {
    case "assign_task": {
      if (ctx.taskId) {
        const assignedId = db.tasks.autoAssignTask(ctx.taskId, ctx.companyId);
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
          db.tasks.saveTask({
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
      const cfg = config as AutomationActionConfigMap["create_task"];
      const title = cfg.title ?? "[Auto] Task from automation rule";
      const description = cfg.description ?? "";
      const priority = cfg.priority ?? "medium";
      const assigneeAgentId = cfg.assigneeAgentId ?? null;
      const taskValidation = validateTaskCreation({ title, description });
      if (!taskValidation.valid) {
        logger.warn(`[automation] Skipping create_task — validation failed: ${taskValidation.errors.join("; ")}`);
        break;
      }
      const taskId = db.tasks.saveTask({
        companyId: ctx.companyId,
        projectId: ctx.projectId ?? cfg.projectId ?? null,
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
      const cfg = config as AutomationActionConfigMap["notify_agent"];
      const toAgentId = cfg.toAgentId ?? ctx.agentId ?? null;
      const fromAgentId = cfg.fromAgentId ?? ctx.agentId ?? toAgentId;
      if (!fromAgentId) break;
      const defaultChannel = toAgentId ? "direct" : "company";
      const requestedChannel = cfg.channel ?? defaultChannel;
      const channel = (["direct", "department", "company", "project", "incident"] as const).includes(requestedChannel)
        ? requestedChannel
        : defaultChannel;
      let channelTargetId: string | null = cfg.channelTargetId ?? cfg.department ?? ctx.department ?? null;
      if (channel === "department" && !channelTargetId && fromAgentId) {
        try {
          const sender = db.entityCrud.getAgent(fromAgentId);
          channelTargetId = sender.department ?? null;
        } catch (err) {
          logger.warn(`[automation] getAgent failed for sender ${fromAgentId}; dropping department target:`, err instanceof Error ? err.message : String(err));
          channelTargetId = null;
        }
      }
      // `dispatchAgentMessage` rejects department / project messages
      // that arrive without a channel target. The default rule
      // "Notify department on task completion" is agent-agnostic
      // (the operator may not have a department per agent), so a
      // single-person company or any agent without a department
      // routinely lands here. Treat the missing target as "no
      // recipients available" and skip — the previous behaviour
      // logged a noisy WARN that looked like a real failure.
      const channelNeedsTarget = channel === "department" || channel === "project";
      if (channelNeedsTarget && !channelTargetId) {
        logger.info(
          `[automation] Skipping rule "${rule.name}" — no ${channel} channel target available for sender ${fromAgentId}`,
        );
        break;
      }
      const dispatchResult = dispatchAgentMessage(
        { db, emitEvent, publishDomainChanged, wakeAgentIfPossible },
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
          const manager = db.agents.getManagerForAgent(ctx.agentId);
          targetAgentId = manager?.id ?? ctx.agentId;
        } else {
          targetAgentId = ctx.agentId;
        }
      }
      if (targetAgentId) {
        wakeAgentIfPossible(targetAgentId, ctx.companyId, deriveHeartbeatWakeTrigger(rule.trigger ?? "", ctx.previousStatus ?? null));
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
      const previousTask = db.entityCrud.getTask(ctx.taskId);
      db.tasks.advanceTaskStatus(ctx.taskId, newStatus, "Status changed by automation rule");
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
        agentName = db.entityCrud.getAgent(targetAgentId).name;
      } catch (err) {
        logger.warn(`[automation] getAgent failed for escalation target ${targetAgentId}; using generic label:`, err instanceof Error ? err.message : String(err));
      }
      let taskTitle = ctx.taskId ?? "unknown";
      try {
        if (ctx.taskId) taskTitle = db.entityCrud.getTask(ctx.taskId).title;
      } catch (err) {
        logger.warn(`[automation] getTask failed for escalation task ${ctx.taskId}; using id as title:`, err instanceof Error ? err.message : String(err));
      }
      const manager = db.agents.getManagerForAgent(targetAgentId);
      const escalationBody = (config.body as string) ?? `Task "${taskTitle}" needs your attention. ${agentName} has flagged this as requiring manager intervention.`;
      const wakeTrigger = deriveEscalationWakeTrigger(ctx.newStatus ?? null, rule.trigger ?? null);
      if (manager) {
        const escalationResult = dispatchAgentMessage(
          { db, emitEvent, publishDomainChanged, wakeAgentIfPossible },
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
        // Skip posting to company channel to avoid flooding it with system noise.
        // The task status change is already visible in the task list and activity log.
        logger.info(`[automation] Skipping escalation for top-level agent "${agentName}" — no manager to escalate to.`);
      }
      break;
    }
    case "cross_department_notify": {
      const targetDepartment = rule.targetDepartment ?? (config.department as string);
      if (!targetDepartment) break;
      const departmentAgents = db.agents.getIdleAgentsForDepartment(ctx.companyId, targetDepartment);
      const senderAgentId = ctx.agentId ?? departmentAgents[0]?.id;
      if (senderAgentId) {
        const dispatchResult = dispatchAgentMessage(
          { db, emitEvent, publishDomainChanged, wakeAgentIfPossible },
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
      const cfg = config as AutomationActionConfigMap["schedule_meeting"];
      const meetingType = cfg.meetingType ?? "department_sync";
      const title = cfg.title ?? "Auto-scheduled meeting";
      // Prefer an absolute scheduledAt; otherwise honor scheduleOffsetMinutes.
      // Default to +60min only when the rule specifies no time at all.
      const offsetMinutes = cfg.scheduleOffsetMinutes ?? 60;
      const scheduledAt = cfg.scheduledAt ?? new Date(Date.now() + offsetMinutes * 60_000).toISOString();
      db.saveMeeting({
        companyId: ctx.companyId,
        type: meetingType,
        title,
        organizerAgentId: ctx.agentId ?? null,
        participantAgentIds: cfg.participantAgentIds ?? "[]",
        scheduledAt,
        durationMinutes: cfg.durationMinutes ?? 30,
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
      const newAssignee = db.tasks.autoAssignTask(ctx.taskId, ctx.companyId);
      if (newAssignee) {
        wakeAgentIfPossible(newAssignee, ctx.companyId, "assignment");
      }
      break;
    }
    case "run_task": {
      const targetTaskId = (config.taskId as string) ?? ctx.taskId;
      if (!targetTaskId) break;
      const task = db.entityCrud.getTask(targetTaskId);
      if (!task.assigneeAgentId) break;
      wakeAgentIfPossible(task.assigneeAgentId, ctx.companyId, "assignment");
      break;
    }
    default:
      throw new Error(`Unknown automation action: ${rule.action}`);
  }
}
