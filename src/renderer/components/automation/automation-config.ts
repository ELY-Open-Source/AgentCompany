import type { AutomationAction, AutomationStatus, AutomationTrigger, WorkflowStatus, WorkflowStep } from "@shared/types"
import { ArrowsClockwise, Eye, Funnel, Lightning, Pause, Play, Plus, Robot, Timer, Trash } from "@phosphor-icons/react"
import { DEPARTMENT_OPTIONS } from "@shared/constants"

export const ACCENT = "var(--accent)"
export const LINE = "var(--line)"

export const triggerConfig: Record<AutomationTrigger, { label: string; description: string; icon: typeof Lightning }> = {
  task_status_changed: { label: "Task Status Changed", description: "When a task transitions to a new status", icon: ArrowsClockwise },
  task_created: { label: "Task Created", description: "When a new task is added to the system", icon: Plus },
  task_blocked: { label: "Task Blocked", description: "When a task becomes blocked by a dependency", icon: Pause },
  task_reassigned: { label: "Task Reassigned", description: "When a task is reassigned to a different agent", icon: ArrowsClockwise },
  run_completed: { label: "Run Completed", description: "When an agent run finishes successfully", icon: Play },
  run_failed: { label: "Run Failed", description: "When an agent run encounters an error", icon: Trash },
  approval_created: { label: "Approval Created", description: "When a new approval request needs review", icon: Eye },
  approval_resolved: { label: "Approval Resolved", description: "When a pending approval is decided", icon: Eye },
  budget_threshold: { label: "Budget Threshold", description: "When spending exceeds a configured limit", icon: Funnel },
  agent_idle: { label: "Agent Idle", description: "When an agent has no tasks and becomes idle", icon: Robot },
  comment_posted: { label: "Comment Posted", description: "When a new comment is added to a task", icon: Lightning },
  document_created: { label: "Document Created", description: "When a new document is generated", icon: Lightning },
  schedule: { label: "Scheduled", description: "Runs on a cron-like schedule automatically", icon: Timer },
  hire_approved: { label: "Hire Approved", description: "When a new agent hire is approved", icon: Robot },
  sprint_started: { label: "Sprint Started", description: "When a sprint transitions to active", icon: Play },
  sprint_ended: { label: "Sprint Ended", description: "When a sprint reaches completion", icon: ArrowsClockwise },
}

export const actionConfig: Record<AutomationAction, { label: string; description: string }> = {
  assign_task: { label: "Assign Task", description: "Auto-assign a task to the best available agent" },
  create_task: { label: "Create Task", description: "Generate a new task from a template" },
  notify_agent: { label: "Notify Agent", description: "Send a notification to a specific agent" },
  send_message: { label: "Send Message", description: "Deliver a message via inter-agent messaging" },
  trigger_heartbeat: { label: "Trigger Heartbeat", description: "Wake an agent and trigger their heartbeat loop" },
  create_approval: { label: "Create Approval", description: "Request human approval before proceeding" },
  update_task_status: { label: "Update Task Status", description: "Move a task to a new status column" },
  escalate_to_manager: { label: "Escalate to Manager", description: "Route to the responsible manager for review" },
  cross_department_notify: { label: "Cross-Dept Notify", description: "Alert another department about this event" },
  schedule_meeting: { label: "Schedule Meeting", description: "Create a meeting with relevant participants" },
  create_document: { label: "Create Document", description: "Generate a document from a template" },
  auto_approve: { label: "Auto Approve", description: "Automatically approve matching requests" },
  reassign_task: { label: "Reassign Task", description: "Move task to a different agent" },
  run_task: { label: "Run Task", description: "Immediately execute the task with an agent" },
}

export const departmentOptions = DEPARTMENT_OPTIONS

export const statusColors: Record<AutomationStatus, { bg: string; text: string; dot: string }> = {
  active: { bg: "var(--success-soft)", text: "var(--success)", dot: "var(--success)" },
  paused: { bg: "var(--warn-soft)", text: "var(--warn)", dot: "var(--warn)" },
  disabled: { bg: "var(--panel-soft)", text: "var(--muted)", dot: "var(--muted)" },
  error: { bg: "var(--danger-soft)", text: "var(--danger)", dot: "var(--danger)" },
}

export const workflowStatusColors: Record<WorkflowStatus, { bg: string; text: string; dot: string }> = {
  draft: { bg: "var(--panel-soft)", text: "var(--muted-strong)", dot: "var(--muted)" },
  active: { bg: "var(--success-soft)", text: "var(--success)", dot: "var(--success)" },
  paused: { bg: "var(--warn-soft)", text: "var(--warn)", dot: "var(--warn)" },
  completed: { bg: "var(--success-soft)", text: "var(--success)", dot: "var(--success)" },
  failed: { bg: "var(--danger-soft)", text: "var(--danger)", dot: "var(--danger)" },
}

export const stepStatusConfig: Record<WorkflowStep["status"], { bg: string; border: string; text: string }> = {
  pending: { bg: "var(--panel-soft)", border: "var(--line)", text: "var(--muted)" },
  running: { bg: "var(--accent-soft)", border: ACCENT, text: ACCENT },
  completed: { bg: "var(--success-soft)", border: "var(--success)", text: "var(--success)" },
  failed: { bg: "var(--danger-soft)", border: "var(--danger)", text: "var(--danger)" },
  skipped: { bg: "var(--panel-soft)", border: "var(--line)", text: "var(--muted)" },
}

export interface AutomationLogEntry { ruleId: string; ruleName: string; trigger: string; action: string; executedAt: string }

export function safeJsonParse(json: string): unknown { try { return JSON.parse(json) } catch { return {} } }
export function safeJsonStringify(value: string): string { try { const parsed = JSON.parse(value); return JSON.stringify(parsed, null, 2) } catch { return value } }
