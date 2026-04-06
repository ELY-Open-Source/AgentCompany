import type { AppDatabase } from "../database";
import type { AutomationAction, DesktopEvent } from "@shared/types";
import { dispatchAgentMessage } from "../message-dispatch";
import { validateTaskCreation } from "../task-quality-gates";
import type { AutomationEventContext } from "./types";

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
      const isHeartbeat = title.startsWith("[Heartbeat]");
      const taskValidation = validateTaskCreation({ title, description }, isHeartbeat);
      if (!taskValidation.valid) {
        logger.warn(`[automation] Skipping create_task — validation failed: ${taskValidation.errors.join("; ")}`);
        break;
      }
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
      // Heartbeat tasks are internal system tasks — skip escalation messages to avoid flooding channels.
      if (taskTitle.startsWith("[Heartbeat]")) {
        logger.info(`[automation] Skipping escalation for heartbeat task "${taskTitle}"`);
        break;
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
      const departmentAgents = db.getIdleAgentsForDepartment(ctx.companyId, targetDepartment);
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
