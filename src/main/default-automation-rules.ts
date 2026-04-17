interface DefaultAutomationRule {
  name: string;
  description: string;
  trigger: string;
  action: string;
  /** Typed condition config. Stringified once at seed time. */
  conditions?: Record<string, unknown>;
  /** Typed action config. Stringified once at seed time. */
  actionConfig?: Record<string, unknown>;
  priority?: number;
}

export const DEFAULT_AUTOMATION_RULES: ReadonlyArray<DefaultAutomationRule> = [
  {
    name: "Auto-assign new tasks",
    description: "Automatically assign new unassigned tasks to the best-fit agent based on capabilities and workload.",
    trigger: "task_created",
    action: "assign_task",
    priority: 90,
  },
  {
    name: "Escalate blocked tasks",
    description: "When a task is blocked, escalate to the assignee's manager.",
    trigger: "task_blocked",
    action: "escalate_to_manager",
    actionConfig: { body: "A task assigned to your report is blocked and needs your attention." },
    priority: 85,
  },
  {
    name: "Escalate completed work to manager",
    description: "When a run completes successfully, escalate to the assignee's manager so they can review the completed work.",
    trigger: "run_completed",
    action: "escalate_to_manager",
    actionConfig: { body: "A task run has completed successfully. The task has moved to review status. Please review and either approve (mark as done) or send back with feedback." },
    priority: 80,
  },
  {
    name: "Reassign on run failure",
    description: "When a run fails after exhausting retries, attempt to reassign the task to another capable agent.",
    trigger: "run_failed",
    action: "reassign_task",
    conditions: { afterRetryExhaustion: true },
    priority: 75,
  },
  {
    name: "Budget alert at 80%",
    description: "Send an alert when an agent reaches 80% of their monthly budget.",
    trigger: "budget_threshold",
    action: "send_message",
    actionConfig: { subject: "Budget warning", body: "Agent is approaching budget limit (80% utilized).", priority: "urgent" },
    priority: 70,
  },
  {
    name: "Notify department on task completion",
    description: "When a run completes successfully, send a status update to the agent's department channel.",
    trigger: "run_completed",
    action: "send_message",
    actionConfig: { channel: "department", subject: "Task completed", body: "A task has been completed successfully. Check the task details for more information.", priority: "low" },
    priority: 40,
  },
  {
    name: "Wake new hire on approval",
    description: "When a new agent hire is approved, immediately wake the new agent to start onboarding.",
    trigger: "hire_approved",
    action: "trigger_heartbeat",
    actionConfig: {},
    priority: 90,
  },
  {
    name: "Auto-run assigned tasks",
    description: "When a task transitions to 'todo' status, automatically wake the assigned agent to start working on it.",
    trigger: "task_status_changed",
    conditions: { status: "todo" },
    action: "run_task",
    actionConfig: {},
    priority: 65,
  },
  {
    name: "Notify company on sprint start",
    description: "When a sprint starts, notify the entire company.",
    trigger: "sprint_started",
    action: "send_message",
    actionConfig: { channel: "company", subject: "Sprint started", body: "A new sprint has begun. Check your assigned tasks and start execution.", priority: "normal" },
    priority: 50,
  },
  {
    name: "Schedule retrospective on sprint end",
    description: "When a sprint ends, schedule a retrospective meeting.",
    trigger: "sprint_ended",
    action: "schedule_meeting",
    actionConfig: { meetingType: "retrospective", title: "Sprint Retrospective", durationMinutes: 45 },
    priority: 55,
  },
  {
    name: "Auto-assign work to idle agents",
    description: "When an agent has been idle for 10+ minutes, automatically assign available unassigned tasks from the backlog.",
    trigger: "agent_idle",
    action: "assign_task",
    priority: 60,
  },
  {
    name: "Wake idle agents to check for work",
    description: "When an agent has no tasks and is idle, wake them so they can check for available work and coordinate with their team.",
    trigger: "agent_idle",
    action: "trigger_heartbeat",
    priority: 45,
  },
  {
    name: "Wake manager when task moves to review",
    description: "When a task status changes to in_review, wake the assignee's manager to review the work.",
    trigger: "task_status_changed",
    conditions: { status: "in_review" },
    action: "escalate_to_manager",
    actionConfig: { body: "A task from your report has been submitted for review. Please review the work and either approve (mark as done) or send back with feedback." },
    priority: 82,
  },
  {
    name: "Wake assigned agent on task feedback",
    description: "When a reviewed task is sent back to in_progress with feedback, wake the assigned agent to address the feedback.",
    trigger: "task_status_changed",
    conditions: { status: "in_progress", previousStatus: "in_review" },
    action: "trigger_heartbeat",
    actionConfig: {},
    priority: 78,
  },
  {
    name: "Wake approvers on new approval",
    description: "When a new approval request is created and not auto-approved, escalate to the requesting agent's manager for review.",
    trigger: "approval_created",
    action: "escalate_to_manager",
    actionConfig: { body: "A new approval request needs your review. Please check the Approvals section." },
    priority: 88,
  },
];

export function seedDefaultAutomationRules(
  companyId: string,
  deps: {
    listAutomationRuleNames: (companyId: string) => Set<string>;
    saveAutomationRule: (input: {
      companyId: string;
      name: string;
      description?: string;
      trigger: string;
      conditionsJson?: string;
      action: string;
      actionConfigJson?: string;
      priority?: number;
      status?: string;
    }) => string;
  },
) {
  const existingRuleNames = deps.listAutomationRuleNames(companyId);
  for (const rule of DEFAULT_AUTOMATION_RULES) {
    if (existingRuleNames.has(rule.name)) {
      continue;
    }
    deps.saveAutomationRule({
      companyId,
      name: rule.name,
      description: rule.description,
      trigger: rule.trigger,
      conditionsJson: JSON.stringify(rule.conditions ?? {}),
      action: rule.action,
      actionConfigJson: JSON.stringify(rule.actionConfig ?? {}),
      priority: rule.priority ?? 50,
      status: "active",
    });
  }
}
