import type { AutomationAction } from "@shared/types";
import { dispatchAgentMessage } from "../messaging/dispatch";
import { validateTaskCreation } from "../task-quality-gates";
import { resolveTaskWorkspaceBinding } from "../task-workspace-binding";
import {
  createAutomationActionHandler,
  type AutomationActionHandler,
  type TypedAutomationActionExecution,
} from "./automation-action-runtime";

const HEARTBEAT_WAKE_TRIGGER_MAP: Record<string, string> = {
  run_completed: "subtask_completed",
  run_failed: "report_failed",
  hire_approved: "assignment",
  agent_idle: "timer",
};

const ESCALATION_STATUS_TRIGGER_MAP: Record<string, string> = {
  in_review: "subtask_completed",
  blocked: "report_blocked",
};

const ESCALATION_RULE_TRIGGER_MAP: Record<string, string> = {
  run_completed: "subtask_completed",
  run_failed: "report_failed",
};

const TASK_PRIORITY_SCORE: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export const AUTOMATION_ACTION_HANDLERS = {
  assign_task: createAutomationActionHandler("assign_task", handleAssignTask),
  create_task: createAutomationActionHandler("create_task", handleCreateTask),
  notify_agent: createAutomationActionHandler("notify_agent", handleAgentNotification),
  send_message: createAutomationActionHandler("send_message", handleAgentNotification),
  trigger_heartbeat: createAutomationActionHandler("trigger_heartbeat", handleTriggerHeartbeat),
  create_approval: createAutomationActionHandler("create_approval", handleCreateApproval),
  update_task_status: createAutomationActionHandler("update_task_status", handleUpdateTaskStatus),
  escalate_to_manager: createAutomationActionHandler("escalate_to_manager", handleEscalateToManager),
  cross_department_notify: createAutomationActionHandler("cross_department_notify", handleCrossDepartmentNotify),
  schedule_meeting: createAutomationActionHandler("schedule_meeting", handleScheduleMeeting),
  create_document: createAutomationActionHandler("create_document", handleCreateDocument),
  auto_approve: createAutomationActionHandler("auto_approve", handleAutoApprove),
  reassign_task: createAutomationActionHandler("reassign_task", handleReassignTask),
  run_task: createAutomationActionHandler("run_task", handleRunTask),
} satisfies Record<AutomationAction, AutomationActionHandler>;

function deriveHeartbeatWakeTrigger(triggerType: string, previousStatus: string | null): string {
  if (triggerType === "task_status_changed" && previousStatus === "in_review") return "comment";
  return HEARTBEAT_WAKE_TRIGGER_MAP[triggerType] ?? "manual";
}

function deriveEscalationWakeTrigger(newStatus: string | null, ruleTrigger: string | null): string {
  if (newStatus && ESCALATION_STATUS_TRIGGER_MAP[newStatus]) return ESCALATION_STATUS_TRIGGER_MAP[newStatus];
  if (ruleTrigger && ESCALATION_RULE_TRIGGER_MAP[ruleTrigger]) return ESCALATION_RULE_TRIGGER_MAP[ruleTrigger];
  return "report_blocked";
}

function handleAssignTask({ deps, ctx }: TypedAutomationActionExecution<"assign_task">): void {
  const { db, logger, wakeAgentIfPossible } = deps;

  if (ctx.taskId) {
    const assignedId = db.core.tasks.autoAssignTask(ctx.taskId, ctx.companyId);
    if (assignedId) {
      wakeAgentIfPossible(assignedId, ctx.companyId, "assignment");
    }
    return;
  }

  if (!ctx.agentId) return;

  const snapshot = db.projection.snapshot.listSnapshot();
  const unassigned = snapshot.tasks
    .filter((task) => task.companyId === ctx.companyId && !task.assigneeAgentId && ["backlog", "todo"].includes(task.status))
    .sort((a, b) => (TASK_PRIORITY_SCORE[b.priority] ?? 0) - (TASK_PRIORITY_SCORE[a.priority] ?? 0));
  if (unassigned.length === 0) return;

  const task = unassigned[0]!;
  db.core.tasks.saveTask({
    id: task.id,
    companyId: task.companyId,
    projectId: task.projectId,
    goalId: task.goalId,
    parentId: task.parentId,
    title: task.title,
    description: task.description,
    assigneeAgentId: ctx.agentId,
    workspaceId: task.workspaceId,
    requiresFilesystem: task.requiresFilesystem,
    priority: task.priority,
    status: "todo",
  });
  wakeAgentIfPossible(ctx.agentId, ctx.companyId, "assignment");
  logger.info(`[automation] Auto-assigned task "${task.title}" to idle agent ${ctx.agentId}`);
}

function handleCreateTask({ deps, callbacks, ctx, config }: TypedAutomationActionExecution<"create_task">): void {
  const { db, logger } = deps;
  const { handleTaskCreated } = callbacks;
  const title = config.title ?? "[Auto] Task from automation rule";
  const description = config.description ?? "";
  const priority = config.priority ?? "medium";
  const assigneeAgentId = config.assigneeAgentId ?? null;
  const taskValidation = validateTaskCreation({ title, description });

  if (!taskValidation.valid) {
    logger.warn(`[automation] Skipping create_task - validation failed: ${taskValidation.errors.join("; ")}`);
    return;
  }

  const workspaceBinding = resolveTaskWorkspaceBinding(db, {
    companyId: ctx.companyId,
    requiresFilesystem: config.requiresFilesystem,
    explicitWorkspaceId: config.workspaceId ?? null,
    projectId: ctx.projectId ?? config.projectId ?? null,
    assigneeAgentId,
    creatorAgentId: ctx.agentId ?? null,
  });
  if (!workspaceBinding.ok) {
    logger.warn(`[automation] Skipping create_task - ${workspaceBinding.error}`);
    return;
  }

  const taskId = db.core.tasks.saveTask({
    companyId: ctx.companyId,
    projectId: ctx.projectId ?? config.projectId ?? null,
    title,
    description,
    assigneeAgentId,
    workspaceId: workspaceBinding.workspaceId,
    priority,
    status: assigneeAgentId ? "todo" : "backlog",
    requiresFilesystem: config.requiresFilesystem,
  });
  handleTaskCreated(taskId, ctx.companyId);
  logger.info(`[automation] Created task: ${title} (${taskId})`);
}

function handleAgentNotification<K extends "notify_agent" | "send_message">({
  deps,
  rule,
  ctx,
  config,
}: TypedAutomationActionExecution<K>): void {
  const { db, logger, emitEvent, publishDomainChanged, wakeAgentIfPossible } = deps;
  const toAgentId = config.toAgentId ?? ctx.agentId ?? null;
  const fromAgentId = config.fromAgentId ?? ctx.agentId ?? toAgentId;
  if (!fromAgentId) return;

  const defaultChannel = toAgentId ? "direct" : "company";
  const requestedChannel = config.channel ?? defaultChannel;
  const channel = (["direct", "department", "company", "project", "incident"] as const).includes(requestedChannel)
    ? requestedChannel
    : defaultChannel;
  let channelTargetId: string | null = config.channelTargetId ?? config.department ?? ctx.department ?? null;

  if (channel === "department" && !channelTargetId) {
    try {
      const sender = db.core.entity.getAgent(fromAgentId);
      channelTargetId = sender.department ?? null;
    } catch (err) {
      logger.warn(`[automation] getAgent failed for sender ${fromAgentId}; dropping department target:`, err instanceof Error ? err.message : String(err));
      channelTargetId = null;
    }
  }

  const channelNeedsTarget = channel === "department" || channel === "project";
  if (channelNeedsTarget && !channelTargetId) {
    logger.info(
      `[automation] Skipping rule "${rule.name}" - no ${channel} channel target available for sender ${fromAgentId}`,
    );
    return;
  }
  if (channel === "direct" && toAgentId === fromAgentId) {
    logger.info(
      `[automation] Skipping rule "${rule.name}" - direct messages require two distinct participants`,
    );
    return;
  }

  const dispatchResult = dispatchAgentMessage(
    { db, emitEvent, publishDomainChanged, wakeAgentIfPossible },
    {
      companyId: ctx.companyId,
      fromAgentId,
      toAgentId: channel === "direct" ? toAgentId : null,
      channel,
      channelTargetId,
      subject: config.subject ?? "Automation notification",
      body: config.body ?? `Automation rule triggered for task ${ctx.taskId ?? "n/a"}`,
      priority: config.priority ?? "normal",
    },
    "message",
  );
  if (!dispatchResult.ok) {
    logger.warn(
      `[automation] Failed to dispatch message for rule ${rule.name} (${rule.id}): ${dispatchResult.error.code} ${dispatchResult.error.message}`,
    );
  }
}

function handleTriggerHeartbeat({ deps, rule, ctx, config }: TypedAutomationActionExecution<"trigger_heartbeat">): void {
  const { db, wakeAgentIfPossible } = deps;
  let targetAgentId = config.agentId ?? null;

  if (!targetAgentId && ctx.agentId) {
    const triggerType = rule.trigger ?? "";
    if (triggerType === "run_completed" || triggerType === "run_failed") {
      const manager = db.core.agents.getManagerForAgent(ctx.agentId);
      targetAgentId = manager?.id ?? ctx.agentId;
    } else {
      targetAgentId = ctx.agentId;
    }
  }

  if (targetAgentId) {
    wakeAgentIfPossible(targetAgentId, ctx.companyId, deriveHeartbeatWakeTrigger(rule.trigger ?? "", ctx.previousStatus ?? null));
  }
}

function handleCreateApproval({ deps, ctx, config }: TypedAutomationActionExecution<"create_approval">): void {
  deps.db.core.approvals.requestApproval({
    companyId: ctx.companyId,
    relatedTaskId: ctx.taskId ?? null,
    requestedByAgentId: ctx.agentId ?? null,
    type: config.approvalType ?? "document_review",
    payloadSummary: config.summary ?? "Auto-generated approval request",
    impactSummary: config.impact ?? "Triggered by automation rule",
  });
}

function handleUpdateTaskStatus({
  deps,
  callbacks,
  rule,
  ctx,
  config,
}: TypedAutomationActionExecution<"update_task_status">): void {
  if (!ctx.taskId) return;

  const { db, publishDomainChanged } = deps;
  const { handleTaskStatusChange } = callbacks;
  const newStatus = config.status ?? "todo";
  const previousTask = db.core.entity.getTask(ctx.taskId);
  db.core.tasks.advanceTaskStatus(ctx.taskId, newStatus, "Status changed by automation rule");
  publishDomainChanged();

  if (previousTask.status !== newStatus && rule.trigger !== "task_status_changed") {
    handleTaskStatusChange(ctx.taskId, ctx.companyId, previousTask.status, newStatus);
  }
}

function handleEscalateToManager({
  deps,
  rule,
  ctx,
  config,
}: TypedAutomationActionExecution<"escalate_to_manager">): void {
  const { db, logger, emitEvent, publishDomainChanged, wakeAgentIfPossible } = deps;
  const targetAgentId = ctx.agentId;
  if (!targetAgentId) return;

  let agentName = "an agent";
  try {
    agentName = db.core.entity.getAgent(targetAgentId).name;
  } catch (err) {
    logger.warn(`[automation] getAgent failed for escalation target ${targetAgentId}; using generic label:`, err instanceof Error ? err.message : String(err));
  }

  let taskTitle = ctx.taskId ?? "unknown";
  try {
    if (ctx.taskId) taskTitle = db.core.entity.getTask(ctx.taskId).title;
  } catch (err) {
    logger.warn(`[automation] getTask failed for escalation task ${ctx.taskId}; using id as title:`, err instanceof Error ? err.message : String(err));
  }

  const manager = db.core.agents.getManagerForAgent(targetAgentId);
  const escalationBody = config.body ?? `Task "${taskTitle}" needs your attention. ${agentName} has flagged this as requiring manager intervention.`;
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
    return;
  }

  logger.info(`[automation] Skipping escalation for top-level agent "${agentName}" - no manager to escalate to.`);
}

function handleCrossDepartmentNotify({
  deps,
  rule,
  ctx,
  config,
}: TypedAutomationActionExecution<"cross_department_notify">): void {
  const { db, logger, emitEvent, publishDomainChanged, wakeAgentIfPossible } = deps;
  const targetDepartment = rule.targetDepartment ?? config.department;
  if (!targetDepartment) return;

  const departmentAgents = db.core.agents.getIdleAgentsForDepartment(ctx.companyId, targetDepartment);
  const senderAgentId = ctx.agentId ?? departmentAgents[0]?.id;
  if (!senderAgentId) return;

  const dispatchResult = dispatchAgentMessage(
    { db, emitEvent, publishDomainChanged, wakeAgentIfPossible },
    {
      companyId: ctx.companyId,
      fromAgentId: senderAgentId,
      toAgentId: null,
      channel: "department",
      channelTargetId: targetDepartment,
      subject: config.subject ?? "Cross-department notification",
      body: config.body ?? "Automation triggered a cross-department alert.",
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

function handleScheduleMeeting({ deps, ctx, config }: TypedAutomationActionExecution<"schedule_meeting">): void {
  const meetingType = config.meetingType ?? "department_sync";
  const title = config.title ?? "Auto-scheduled meeting";
  const offsetMinutes = config.scheduleOffsetMinutes ?? 60;
  const scheduledAt = config.scheduledAt ?? new Date(Date.now() + offsetMinutes * 60_000).toISOString();

  deps.db.core.knowledge.saveMeeting({
    companyId: ctx.companyId,
    type: meetingType,
    title,
    organizerAgentId: ctx.agentId ?? null,
    participantAgentIds: config.participantAgentIds ?? "[]",
    scheduledAt,
    durationMinutes: config.durationMinutes ?? 30,
  });
}

function handleCreateDocument({ deps, ctx, config }: TypedAutomationActionExecution<"create_document">): void {
  deps.db.core.documents.saveDocument({
    companyId: ctx.companyId,
    type: config.documentType ?? "status_report",
    title: config.title ?? "Auto-generated document",
    content: config.content ?? "",
    authorAgentId: ctx.agentId ?? null,
    projectId: ctx.projectId ?? null,
  });
}

function handleAutoApprove({ deps, callbacks, ctx }: TypedAutomationActionExecution<"auto_approve">): void {
  const snapshot = deps.db.projection.snapshot.listSnapshot();
  const pendingApprovals = snapshot.approvals.filter(
    (approval) => approval.companyId === ctx.companyId && approval.state === "pending",
  );

  for (const approval of pendingApprovals.slice(0, 5)) {
    deps.db.core.approvals.decideApproval({
      companyId: ctx.companyId,
      approvalId: approval.id,
      state: "approved",
      decisionNote: "Auto-approved by automation rule.",
    });
    callbacks.handleApprovalResolved(approval.id, ctx.companyId, "approved");
  }
}

function handleReassignTask({ deps, ctx }: TypedAutomationActionExecution<"reassign_task">): void {
  if (!ctx.taskId) return;

  const newAssignee = deps.db.core.tasks.autoAssignTask(ctx.taskId, ctx.companyId);
  if (newAssignee) {
    deps.wakeAgentIfPossible(newAssignee, ctx.companyId, "assignment");
  }
}

function handleRunTask({ deps, ctx, config }: TypedAutomationActionExecution<"run_task">): void {
  const targetTaskId = config.taskId ?? ctx.taskId;
  if (!targetTaskId) return;

  const task = deps.db.core.entity.getTask(targetTaskId);
  if (!task.assigneeAgentId) return;
  deps.wakeAgentIfPossible(task.assigneeAgentId, ctx.companyId, "assignment");
}
