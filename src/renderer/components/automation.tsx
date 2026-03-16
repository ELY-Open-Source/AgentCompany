import { useCallback, useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowRight,
  ArrowsClockwise,
  CaretRight,
  Eye,
  Funnel,
  Gear,
  Lightning,
  Pause,
  Play,
  Plus,
  Robot,
  Timer,
  Trash,
  X,
} from "@phosphor-icons/react"
import type {
  AgentRecord,
  AutomationAction,
  AutomationRuleRecord,
  AutomationStatus,
  AutomationTrigger,
  DepartmentId,
  WorkflowPipelineRecord,
  WorkflowStatus,
  WorkflowStep,
} from "@shared/types"
import { ActionButton, Select } from "./ui"

/* ------------------------------------------------------------------ */
/*  Constants & Config                                                  */
/* ------------------------------------------------------------------ */

const ACCENT = "#d97745"
const LINE = "rgba(15,23,42,0.08)"

const triggerConfig: Record<AutomationTrigger, { label: string; description: string; icon: typeof Lightning }> = {
  task_status_changed: { label: "Task Status Changed", description: "When a task transitions to a new status", icon: ArrowsClockwise },
  task_created: { label: "Task Created", description: "When a new task is added to the system", icon: Plus },
  task_blocked: { label: "Task Blocked", description: "When a task becomes blocked by a dependency", icon: Pause },
  run_completed: { label: "Run Completed", description: "When an agent run finishes successfully", icon: Play },
  run_failed: { label: "Run Failed", description: "When an agent run encounters an error", icon: Trash },
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

const actionConfig: Record<AutomationAction, { label: string; description: string }> = {
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

const departmentOptions: Array<{ value: string; label: string }> = [
  { value: "", label: "Any department" },
  { value: "executive", label: "Executive" },
  { value: "engineering", label: "Engineering" },
  { value: "product", label: "Product" },
  { value: "marketing", label: "Marketing" },
  { value: "sales", label: "Sales" },
  { value: "hr", label: "Human Resources" },
  { value: "finance", label: "Finance" },
  { value: "legal", label: "Legal" },
  { value: "operations", label: "Operations" },
  { value: "customer_support", label: "Customer Support" },
  { value: "research", label: "Research" },
  { value: "design", label: "Design" },
]

const statusColors: Record<AutomationStatus, { bg: string; text: string; dot: string }> = {
  active: { bg: "var(--success-soft)", text: "var(--success)", dot: "var(--success)" },
  paused: { bg: "var(--warn-soft)", text: "var(--warn)", dot: "var(--warn)" },
  disabled: { bg: "var(--panel-soft)", text: "var(--muted)", dot: "var(--muted)" },
  error: { bg: "var(--danger-soft)", text: "var(--danger)", dot: "var(--danger)" },
}

const workflowStatusColors: Record<WorkflowStatus, { bg: string; text: string; dot: string }> = {
  draft: { bg: "var(--panel-soft)", text: "var(--muted-strong)", dot: "var(--muted)" },
  active: { bg: "var(--success-soft)", text: "var(--success)", dot: "var(--success)" },
  paused: { bg: "var(--warn-soft)", text: "var(--warn)", dot: "var(--warn)" },
  completed: { bg: "var(--success-soft)", text: "var(--success)", dot: "var(--success)" },
  failed: { bg: "var(--danger-soft)", text: "var(--danger)", dot: "var(--danger)" },
}

const stepStatusConfig: Record<WorkflowStep["status"], { bg: string; border: string; text: string }> = {
  pending: { bg: "var(--panel-soft)", border: "var(--line)", text: "var(--muted)" },
  running: { bg: "var(--accent-soft)", border: ACCENT, text: ACCENT },
  completed: { bg: "var(--success-soft)", border: "var(--success)", text: "var(--success)" },
  failed: { bg: "var(--danger-soft)", border: "var(--danger)", text: "var(--danger)" },
  skipped: { bg: "var(--panel-soft)", border: "var(--line)", text: "var(--muted)" },
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never"
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.max(0, now - then)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function safeJsonParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return {}
  }
}

function safeJsonStringify(value: string): string {
  try {
    const parsed = JSON.parse(value)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return value
  }
}

/* ------------------------------------------------------------------ */
/*  Automation Log Entry Type                                           */
/* ------------------------------------------------------------------ */

interface AutomationLogEntry {
  ruleId: string
  ruleName: string
  trigger: string
  action: string
  executedAt: string
}

/* ------------------------------------------------------------------ */
/*  Automation Rule Card                                                */
/* ------------------------------------------------------------------ */

function RuleCard({
  rule,
  onToggle,
  onDelete,
  onEdit,
}: {
  rule: AutomationRuleRecord
  onToggle: () => void
  onDelete: () => void
  onEdit: () => void
}) {
  const triggerInfo = triggerConfig[rule.trigger]
  const actionInfo = actionConfig[rule.action]
  const TriggerIcon = triggerInfo?.icon ?? Lightning
  const colors = statusColors[rule.status]

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="group rounded-[10px] border bg-[color:var(--panel)] transition hover:shadow-sm"
      style={{ borderColor: LINE }}
    >
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Trigger icon */}
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: `${ACCENT}12`, color: ACCENT }}
        >
          <TriggerIcon size={20} weight="fill" />
        </div>

        {/* Main info */}
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-[color:var(--text)]">
              {rule.name}
            </span>
            <span
              className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
              style={{ backgroundColor: colors.bg, color: colors.text }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: colors.dot }}
              />
              {rule.status}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[color:var(--muted)]">
            {/* Trigger label */}
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[color:var(--panel-soft)] px-1.5 py-0.5 font-medium text-[color:var(--muted-strong)]">
              <Lightning size={10} weight="fill" />
              {triggerInfo?.label ?? rule.trigger}
            </span>
            <ArrowRight size={10} className="text-[color:var(--muted)]" />
            {/* Action label */}
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[color:var(--panel-soft)] px-1.5 py-0.5 font-medium text-[color:var(--muted-strong)]">
              <Gear size={10} />
              {actionInfo?.label ?? rule.action}
            </span>
            {/* Department flow */}
            {rule.sourceDepartment || rule.targetDepartment ? (
              <>
                <span className="text-[color:var(--line-strong)]">|</span>
                <span className="inline-flex items-center gap-1">
                  <span className="font-medium text-[color:var(--muted-strong)]">
                    {rule.sourceDepartment ?? "Any"}
                  </span>
                  <CaretRight size={8} />
                  <span className="font-medium text-[color:var(--muted-strong)]">
                    {rule.targetDepartment ?? "Same"}
                  </span>
                </span>
              </>
            ) : null}
          </div>
          {/* Execution stats */}
          <div className="mt-1 flex items-center gap-3 text-[10px] text-[color:var(--muted)]">
            <span>{rule.executionCount} execution{rule.executionCount !== 1 ? "s" : ""}</span>
            <span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" />
            <span>Last run {timeAgo(rule.lastExecutedAt)}</span>
            <span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" />
            <span>Priority {rule.priority}</span>
          </div>
        </button>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggle}
            aria-label={rule.status === "active" ? "Pause rule" : "Activate rule"}
            title={rule.status === "active" ? "Pause rule" : "Activate rule"}
            className="rounded-[6px] p-2 text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
          >
            {rule.status === "active" ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete rule"
            title="Delete rule"
            className="rounded-[6px] p-2 text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--danger-soft)] hover:text-[color:var(--danger)] group-hover:opacity-100"
          >
            <Trash size={15} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Rule Creation / Edit Modal                                          */
/* ------------------------------------------------------------------ */

interface RuleFormState {
  name: string
  description: string
  trigger: AutomationTrigger
  conditionsJson: string
  action: AutomationAction
  actionConfigJson: string
  sourceDepartment: string
  targetDepartment: string
  priority: number
}

const defaultRuleForm: RuleFormState = {
  name: "",
  description: "",
  trigger: "task_status_changed",
  conditionsJson: "{}",
  action: "assign_task",
  actionConfigJson: "{}",
  sourceDepartment: "",
  targetDepartment: "",
  priority: 50,
}

function ruleToFormState(rule: AutomationRuleRecord): RuleFormState {
  return {
    name: rule.name,
    description: rule.description,
    trigger: rule.trigger,
    conditionsJson: safeJsonStringify(rule.conditionsJson),
    action: rule.action,
    actionConfigJson: safeJsonStringify(rule.actionConfigJson),
    sourceDepartment: rule.sourceDepartment ?? "",
    targetDepartment: rule.targetDepartment ?? "",
    priority: rule.priority,
  }
}

function RuleFormModal({
  open,
  editingRule,
  companyId,
  onClose,
  onSaved,
}: {
  open: boolean
  editingRule: AutomationRuleRecord | null
  companyId: string
  onClose: () => void
  onSaved: () => void
}) {
  const isEditing = editingRule !== null
  const [form, setForm] = useState<RuleFormState>(defaultRuleForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(editingRule ? ruleToFormState(editingRule) : defaultRuleForm)
      setError(null)
    }
  }, [open, editingRule])

  const updateField = useCallback(<K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      setError("Rule name is required")
      return
    }
    // Validate JSON fields
    try { JSON.parse(form.conditionsJson) } catch {
      setError("Conditions must be valid JSON")
      return
    }
    try { JSON.parse(form.actionConfigJson) } catch {
      setError("Action config must be valid JSON")
      return
    }

    setSaving(true)
    setError(null)
    try {
      const result = await window.agentCompany.saveAutomationRule({
        id: editingRule?.id ?? null,
        companyId,
        name: form.name.trim(),
        description: form.description.trim(),
        trigger: form.trigger,
        conditionsJson: form.conditionsJson,
        action: form.action,
        actionConfigJson: form.actionConfigJson,
        sourceDepartment: (form.sourceDepartment || null) as DepartmentId | null,
        targetDepartment: (form.targetDepartment || null) as DepartmentId | null,
        priority: form.priority,
        status: editingRule?.status ?? "active",
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rule")
    } finally {
      setSaving(false)
    }
  }, [form, editingRule, companyId, onSaved, onClose])

  if (!open) return null

  const triggerOptions = Object.entries(triggerConfig).map(([key, config]) => ({
    value: key,
    label: config.label,
  }))

  const actionOptions = Object.entries(actionConfig).map(([key, config]) => ({
    value: key,
    label: config.label,
  }))

  const selectedTriggerInfo = triggerConfig[form.trigger]
  const selectedActionInfo = actionConfig[form.action]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="flex w-full max-w-[580px] flex-col rounded-[14px] border bg-[color:var(--panel)] shadow-xl"
        style={{ borderColor: LINE, maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-6 py-4" style={{ borderColor: LINE }}>
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[8px]"
              style={{ backgroundColor: `${ACCENT}15`, color: ACCENT }}
            >
              <Lightning size={18} weight="fill" />
            </div>
            <h2 className="text-[16px] font-bold text-[color:var(--text)]">
              {isEditing ? "Edit Automation Rule" : "New Automation Rule"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            {/* Error */}
            {error ? (
              <div className="rounded-[8px] bg-[color:var(--danger-soft)] px-3.5 py-2.5 text-[12px] font-medium text-[color:var(--danger)]">
                {error}
              </div>
            ) : null}

            {/* Name */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                Rule Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="e.g., Auto-assign blocked tasks"
                className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
                style={{ borderColor: LINE }}
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="What does this rule do?"
                rows={2}
                className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
                style={{ borderColor: LINE }}
              />
            </div>

            {/* Trigger */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                Trigger
              </label>
              <Select
                value={form.trigger}
                onChange={(v) => updateField("trigger", v as AutomationTrigger)}
                options={triggerOptions}
              />
              {selectedTriggerInfo ? (
                <div className="mt-1.5 text-[11px] text-[color:var(--muted)]">
                  {selectedTriggerInfo.description}
                </div>
              ) : null}
            </div>

            {/* Conditions */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                Conditions (JSON)
              </label>
              <textarea
                value={form.conditionsJson}
                onChange={(e) => updateField("conditionsJson", e.target.value)}
                rows={3}
                spellCheck={false}
                className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 font-mono text-[12px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
                style={{ borderColor: LINE }}
                placeholder='{"status": "blocked", "department": "engineering"}'
              />
            </div>

            {/* Action */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                Action
              </label>
              <Select
                value={form.action}
                onChange={(v) => updateField("action", v as AutomationAction)}
                options={actionOptions}
              />
              {selectedActionInfo ? (
                <div className="mt-1.5 text-[11px] text-[color:var(--muted)]">
                  {selectedActionInfo.description}
                </div>
              ) : null}
            </div>

            {/* Action Config */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                Action Configuration (JSON)
              </label>
              <textarea
                value={form.actionConfigJson}
                onChange={(e) => updateField("actionConfigJson", e.target.value)}
                rows={3}
                spellCheck={false}
                className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 font-mono text-[12px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
                style={{ borderColor: LINE }}
                placeholder='{"targetAgentId": "...", "message": "..."}'
              />
            </div>

            {/* Department selectors */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                  Source Department
                </label>
                <Select
                  value={form.sourceDepartment}
                  onChange={(v) => updateField("sourceDepartment", v)}
                  options={departmentOptions}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                  Target Department
                </label>
                <Select
                  value={form.targetDepartment}
                  onChange={(v) => updateField("targetDepartment", v)}
                  options={departmentOptions}
                />
              </div>
            </div>

            {/* Priority slider */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[12px] font-medium text-[color:var(--muted-strong)]">
                  Priority
                </label>
                <span className="text-[12px] font-semibold" style={{ color: ACCENT }}>
                  {form.priority}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={form.priority}
                onChange={(e) => updateField("priority", parseInt(e.target.value, 10))}
                className="w-full accent-[#d97745]"
              />
              <div className="mt-1 flex justify-between text-[10px] text-[color:var(--muted)]">
                <span>Low priority</span>
                <span>High priority</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-3 border-t px-6 py-4" style={{ borderColor: LINE }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-4 py-2 text-[12px] font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
          >
            Cancel
          </button>
          <ActionButton
            label={isEditing ? "Save Changes" : "Create Rule"}
            onClick={() => void handleSave()}
            icon={isEditing ? Gear : Lightning}
            tone="accent"
            loading={saving}
            disabled={!form.name.trim()}
          />
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Delete Confirmation Dialog                                          */
/* ------------------------------------------------------------------ */

function DeleteConfirmDialog({
  open,
  entityName,
  onConfirm,
  onCancel,
}: {
  open: boolean
  entityName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-[380px] rounded-[14px] border bg-[color:var(--panel)] p-6 shadow-xl"
        style={{ borderColor: LINE }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--danger-soft)]">
            <Trash size={16} className="text-[color:var(--danger)]" />
          </div>
          <h3 className="text-[15px] font-bold text-[color:var(--text)]">Delete</h3>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--muted)]">
          Are you sure you want to delete <strong className="text-[color:var(--text)]">{entityName}</strong>? This action cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[8px] px-4 py-2 text-[12px] font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)]"
          >
            Cancel
          </button>
          <ActionButton
            label="Delete"
            onClick={onConfirm}
            icon={Trash}
            tone="danger"
          />
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Activity Log                                                        */
/* ------------------------------------------------------------------ */

function AutomationActivityLog({ entries }: { entries: AutomationLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="py-6 text-center text-[13px] text-[color:var(--muted)]">
        No automation activity yet. Rules will log executions here when they fire.
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {entries.map((entry, idx) => {
        const triggerInfo = triggerConfig[entry.trigger as AutomationTrigger]
        const actionInfo = actionConfig[entry.action as AutomationAction]
        const TriggerIcon = triggerInfo?.icon ?? Lightning

        return (
          <motion.div
            key={`${entry.ruleId}-${entry.executedAt}-${idx}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.03 }}
            className="flex items-center gap-3 rounded-[8px] border bg-[color:var(--panel)] px-4 py-2.5 text-[12px]"
            style={{ borderColor: LINE }}
          >
            <TriggerIcon size={14} style={{ color: ACCENT }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-[color:var(--text)]">{entry.ruleName}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[color:var(--muted)]">
                <span>{triggerInfo?.label ?? entry.trigger}</span>
                <ArrowRight size={8} />
                <span>{actionInfo?.label ?? entry.action}</span>
              </div>
            </div>
            <span className="shrink-0 text-[10px] text-[color:var(--muted)]">
              {timeAgo(entry.executedAt)}
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  AutomationRulesPanel                                                */
/* ------------------------------------------------------------------ */

function AutomationRulesPanel({
  rules,
  companyId,
  onRefresh,
}: {
  rules: AutomationRuleRecord[]
  companyId: string
  onRefresh: () => void
}) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingRule, setEditingRule] = useState<AutomationRuleRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AutomationRuleRecord | null>(null)
  const [activityLog, setActivityLog] = useState<AutomationLogEntry[]>([])
  const [activeTab, setActiveTab] = useState<"rules" | "activity">("rules")
  const [filterStatus, setFilterStatus] = useState<AutomationStatus | "all">("all")

  // Fetch activity log
  useEffect(() => {
    void window.agentCompany.getAutomationLog(companyId).then((result) => {
      if (result.ok) setActivityLog(result.data)
    })
  }, [companyId, rules])

  const filteredRules = useMemo(() => {
    if (filterStatus === "all") return rules
    return rules.filter((r) => r.status === filterStatus)
  }, [rules, filterStatus])

  const counts = useMemo(() => ({
    total: rules.length,
    active: rules.filter((r) => r.status === "active").length,
    paused: rules.filter((r) => r.status === "paused").length,
    error: rules.filter((r) => r.status === "error").length,
  }), [rules])

  const handleToggle = useCallback(async (rule: AutomationRuleRecord) => {
    const newStatus = rule.status === "active" ? "paused" : "active"
    await window.agentCompany.toggleAutomationRule({
      id: rule.id,
      companyId,
      status: newStatus as "active" | "paused",
    })
    onRefresh()
  }, [companyId, onRefresh])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    await window.agentCompany.deleteAutomationRule({
      id: deleteTarget.id,
      companyId,
    })
    setDeleteTarget(null)
    onRefresh()
  }, [deleteTarget, companyId, onRefresh])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: `${ACCENT}15`, color: ACCENT }}
          >
            <Lightning size={20} weight="fill" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[color:var(--text)]">Automation Rules</h2>
            <p className="text-[12px] text-[color:var(--muted)]">
              {counts.active} active, {counts.paused} paused{counts.error > 0 ? `, ${counts.error} errored` : ""}
            </p>
          </div>
        </div>
        <ActionButton
          label="New Rule"
          onClick={() => setShowCreateModal(true)}
          icon={Plus}
          tone="accent"
        />
      </div>

      {/* Stats bar */}
      {rules.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-[10px] border bg-[color:var(--panel)] px-4 py-3" style={{ borderColor: LINE }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Total Rules</div>
            <div className="text-[22px] font-bold text-[color:var(--text)]">{counts.total}</div>
          </div>
          <div className="rounded-[10px] border bg-[color:var(--panel)] px-4 py-3" style={{ borderColor: LINE }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Total Executions</div>
            <div className="text-[22px] font-bold" style={{ color: ACCENT }}>
              {rules.reduce((sum, r) => sum + r.executionCount, 0)}
            </div>
          </div>
          <div className="rounded-[10px] border bg-[color:var(--panel)] px-4 py-3" style={{ borderColor: LINE }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Recent Activity</div>
            <div className="text-[22px] font-bold text-[color:var(--success)]">
              {activityLog.length}
            </div>
          </div>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 rounded-[8px] bg-[color:var(--panel-soft)] p-1">
        <button
          type="button"
          onClick={() => setActiveTab("rules")}
          className={`flex-1 rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition ${
            activeTab === "rules"
              ? "bg-[color:var(--panel)] text-[color:var(--text)] shadow-sm"
              : "text-[color:var(--muted)] hover:text-[color:var(--text)]"
          }`}
        >
          Rules ({rules.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("activity")}
          className={`flex-1 rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition ${
            activeTab === "activity"
              ? "bg-[color:var(--panel)] text-[color:var(--text)] shadow-sm"
              : "text-[color:var(--muted)] hover:text-[color:var(--text)]"
          }`}
        >
          Activity Log ({activityLog.length})
        </button>
      </div>

      {/* Rules content */}
      {activeTab === "rules" ? (
        <>
          {/* Filter */}
          {rules.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {(["all", "active", "paused", "error"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setFilterStatus(status)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                    filterStatus === status
                      ? "text-white"
                      : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)] hover:bg-[color:var(--line)]"
                  }`}
                  style={filterStatus === status ? { backgroundColor: ACCENT } : undefined}
                >
                  {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          ) : null}

          {/* Rule list */}
          {filteredRules.length === 0 && rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed py-16 text-center" style={{ borderColor: LINE }}>
              <Lightning size={36} className="mb-3 text-[color:var(--muted)]" />
              <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">No automation rules</div>
              <div className="mx-auto mt-1 max-w-[42ch] text-[12px] leading-relaxed text-[color:var(--muted)]">
                Create your first rule to make the company autonomous. Rules trigger actions based on events like task changes, run completions, and agent idle states.
              </div>
              <div className="mt-4">
                <ActionButton
                  label="Create First Rule"
                  onClick={() => setShowCreateModal(true)}
                  icon={Lightning}
                  tone="accent"
                />
              </div>
            </div>
          ) : filteredRules.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-[color:var(--muted)]">
              No rules match the current filter.
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {filteredRules.map((rule) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    onToggle={() => void handleToggle(rule)}
                    onDelete={() => setDeleteTarget(rule)}
                    onEdit={() => setEditingRule(rule)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      ) : (
        <AutomationActivityLog entries={activityLog} />
      )}

      {/* Create / Edit modal */}
      <AnimatePresence>
        {showCreateModal ? (
          <RuleFormModal
            open={showCreateModal}
            editingRule={null}
            companyId={companyId}
            onClose={() => setShowCreateModal(false)}
            onSaved={onRefresh}
          />
        ) : null}
        {editingRule ? (
          <RuleFormModal
            open={!!editingRule}
            editingRule={editingRule}
            companyId={companyId}
            onClose={() => setEditingRule(null)}
            onSaved={onRefresh}
          />
        ) : null}
      </AnimatePresence>

      {/* Delete confirmation */}
      <AnimatePresence>
        {deleteTarget ? (
          <DeleteConfirmDialog
            open={!!deleteTarget}
            entityName={deleteTarget.name}
            onConfirm={() => void handleDelete()}
            onCancel={() => setDeleteTarget(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Workflow Step Timeline                                               */
/* ------------------------------------------------------------------ */

function StepTimeline({ steps }: { steps: WorkflowStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="py-4 text-center text-[11px] text-[color:var(--muted)]">
        No steps defined
      </div>
    )
  }

  return (
    <div className="relative pl-5">
      {/* Vertical line */}
      <div
        className="absolute left-[9px] top-2 w-px"
        style={{
          height: `calc(100% - 16px)`,
          backgroundColor: "var(--line)",
        }}
      />

      <div className="space-y-3">
        {steps.map((step, idx) => {
          const colors = stepStatusConfig[step.status]
          const actionInfo = actionConfig[step.action]

          return (
            <div key={step.id} className="relative flex items-start gap-3">
              {/* Dot */}
              <div
                className="absolute -left-5 top-1.5 z-10 h-[10px] w-[10px] rounded-full border-2"
                style={{
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                }}
              />

              {/* Content */}
              <div
                className="flex-1 rounded-[8px] border px-3 py-2.5"
                style={{ borderColor: step.status === "running" ? ACCENT : LINE }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold" style={{ color: colors.text }}>
                      {idx + 1}
                    </span>
                    <span className="text-[12px] font-medium text-[color:var(--text)]">
                      {step.name}
                    </span>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                    style={{ backgroundColor: colors.bg, color: colors.text }}
                  >
                    {step.status}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-[color:var(--muted)]">
                  <span>{actionInfo?.label ?? step.action}</span>
                  {step.assigneeDepartment ? (
                    <>
                      <span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" />
                      <span>{step.assigneeDepartment}</span>
                    </>
                  ) : null}
                  {step.requiresApproval ? (
                    <>
                      <span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" />
                      <span className="text-[color:var(--warn)]">Requires approval</span>
                    </>
                  ) : null}
                  {step.timeoutSec > 0 ? (
                    <>
                      <span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" />
                      <span>{step.timeoutSec}s timeout</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Workflow Card                                                       */
/* ------------------------------------------------------------------ */

function WorkflowCard({
  workflow,
  onDelete,
  onEdit,
}: {
  workflow: WorkflowPipelineRecord
  onDelete: () => void
  onEdit: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const colors = workflowStatusColors[workflow.status]
  const triggerInfo = triggerConfig[workflow.triggerType]
  const TriggerIcon = triggerInfo?.icon ?? Lightning

  const steps: WorkflowStep[] = useMemo(() => {
    const parsed = safeJsonParse(workflow.stepsJson)
    return Array.isArray(parsed) ? (parsed as WorkflowStep[]) : []
  }, [workflow.stepsJson])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="group rounded-[10px] border bg-[color:var(--panel)] transition hover:shadow-sm"
      style={{ borderColor: LINE }}
    >
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Icon */}
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: `${ACCENT}12`, color: ACCENT }}
        >
          <TriggerIcon size={20} weight="fill" />
        </div>

        {/* Main info */}
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-[color:var(--text)]">
              {workflow.name}
            </span>
            <span
              className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
              style={{ backgroundColor: colors.bg, color: colors.text }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: colors.dot }}
              />
              {workflow.status}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-[color:var(--muted)]">
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[color:var(--panel-soft)] px-1.5 py-0.5 font-medium text-[color:var(--muted-strong)]">
              <Lightning size={10} weight="fill" />
              {triggerInfo?.label ?? workflow.triggerType}
            </span>
            <span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" />
            <span>{steps.length} step{steps.length !== 1 ? "s" : ""}</span>
            <span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" />
            <span>{workflow.runCount} run{workflow.runCount !== 1 ? "s" : ""}</span>
            {workflow.lastRunAt ? (
              <>
                <span className="h-0.5 w-0.5 rounded-full bg-[color:var(--muted)]" />
                <span>Last run {timeAgo(workflow.lastRunAt)}</span>
              </>
            ) : null}
          </div>
        </button>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <motion.div
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.15 }}
          >
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-label={expanded ? "Collapse" : "Expand"}
              className="rounded-[6px] p-2 text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
            >
              <CaretRight size={14} />
            </button>
          </motion.div>
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit workflow"
            title="Edit workflow"
            className="rounded-[6px] p-2 text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
          >
            <Gear size={15} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete workflow"
            title="Delete workflow"
            className="rounded-[6px] p-2 text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--danger-soft)] hover:text-[color:var(--danger)] group-hover:opacity-100"
          >
            <Trash size={15} />
          </button>
        </div>
      </div>

      {/* Expanded: step timeline */}
      <AnimatePresence>
        {expanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t px-4 py-4" style={{ borderColor: LINE }}>
              {workflow.description ? (
                <p className="mb-3 text-[12px] leading-relaxed text-[color:var(--muted)]">
                  {workflow.description}
                </p>
              ) : null}
              <StepTimeline steps={steps} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Workflow Creation Modal                                             */
/* ------------------------------------------------------------------ */

interface WorkflowFormState {
  name: string
  description: string
  triggerType: AutomationTrigger
  triggerConfigJson: string
  status: WorkflowStatus
  stepsJson: string
}

const defaultWorkflowForm: WorkflowFormState = {
  name: "",
  description: "",
  triggerType: "task_created",
  triggerConfigJson: "{}",
  status: "draft",
  stepsJson: "[]",
}

function workflowToFormState(wf: WorkflowPipelineRecord): WorkflowFormState {
  return {
    name: wf.name,
    description: wf.description,
    triggerType: wf.triggerType,
    triggerConfigJson: safeJsonStringify(wf.triggerConfigJson),
    status: wf.status,
    stepsJson: safeJsonStringify(wf.stepsJson),
  }
}

function WorkflowFormModal({
  open,
  editingWorkflow,
  companyId,
  onClose,
  onSaved,
}: {
  open: boolean
  editingWorkflow: WorkflowPipelineRecord | null
  companyId: string
  onClose: () => void
  onSaved: () => void
}) {
  const isEditing = editingWorkflow !== null
  const [form, setForm] = useState<WorkflowFormState>(defaultWorkflowForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(editingWorkflow ? workflowToFormState(editingWorkflow) : defaultWorkflowForm)
      setError(null)
    }
  }, [open, editingWorkflow])

  const updateField = useCallback(<K extends keyof WorkflowFormState>(key: K, value: WorkflowFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      setError("Workflow name is required")
      return
    }
    try { JSON.parse(form.triggerConfigJson) } catch {
      setError("Trigger config must be valid JSON")
      return
    }
    try { JSON.parse(form.stepsJson) } catch {
      setError("Steps must be valid JSON array")
      return
    }

    setSaving(true)
    setError(null)
    try {
      const result = await window.agentCompany.saveWorkflow({
        id: editingWorkflow?.id ?? null,
        companyId,
        name: form.name.trim(),
        description: form.description.trim(),
        triggerType: form.triggerType,
        triggerConfigJson: form.triggerConfigJson,
        status: form.status,
        stepsJson: form.stepsJson,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workflow")
    } finally {
      setSaving(false)
    }
  }, [form, editingWorkflow, companyId, onSaved, onClose])

  if (!open) return null

  const triggerOptions = Object.entries(triggerConfig).map(([key, config]) => ({
    value: key,
    label: config.label,
  }))

  const statusOptions: Array<{ value: string; label: string }> = [
    { value: "draft", label: "Draft" },
    { value: "active", label: "Active" },
    { value: "paused", label: "Paused" },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="flex w-full max-w-[540px] flex-col rounded-[14px] border bg-[color:var(--panel)] shadow-xl"
        style={{ borderColor: LINE, maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-6 py-4" style={{ borderColor: LINE }}>
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[8px]"
              style={{ backgroundColor: `${ACCENT}15`, color: ACCENT }}
            >
              <ArrowsClockwise size={18} weight="fill" />
            </div>
            <h2 className="text-[16px] font-bold text-[color:var(--text)]">
              {isEditing ? "Edit Workflow" : "New Workflow"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            {error ? (
              <div className="rounded-[8px] bg-[color:var(--danger-soft)] px-3.5 py-2.5 text-[12px] font-medium text-[color:var(--danger)]">
                {error}
              </div>
            ) : null}

            {/* Name */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                Workflow Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="e.g., Bug Fix Pipeline"
                className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
                style={{ borderColor: LINE }}
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="Describe this workflow pipeline"
                rows={2}
                className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
                style={{ borderColor: LINE }}
              />
            </div>

            {/* Trigger + Status */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                  Trigger
                </label>
                <Select
                  value={form.triggerType}
                  onChange={(v) => updateField("triggerType", v as AutomationTrigger)}
                  options={triggerOptions}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                  Status
                </label>
                <Select
                  value={form.status}
                  onChange={(v) => updateField("status", v as WorkflowStatus)}
                  options={statusOptions}
                />
              </div>
            </div>

            {/* Trigger Config */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                Trigger Configuration (JSON)
              </label>
              <textarea
                value={form.triggerConfigJson}
                onChange={(e) => updateField("triggerConfigJson", e.target.value)}
                rows={2}
                spellCheck={false}
                className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 font-mono text-[12px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
                style={{ borderColor: LINE }}
                placeholder="{}"
              />
            </div>

            {/* Steps */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                Pipeline Steps (JSON Array)
              </label>
              <textarea
                value={form.stepsJson}
                onChange={(e) => updateField("stepsJson", e.target.value)}
                rows={6}
                spellCheck={false}
                className="focus-ring w-full rounded-[8px] border bg-[color:var(--panel)] px-3.5 py-2.5 font-mono text-[12px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
                style={{ borderColor: LINE }}
                placeholder={`[
  {
    "id": "step-1",
    "name": "Assign to engineer",
    "action": "assign_task",
    "configJson": "{}",
    "assigneeDepartment": "engineering",
    "assigneeAgentId": null,
    "requiresApproval": false,
    "timeoutSec": 0,
    "status": "pending"
  }
]`}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-3 border-t px-6 py-4" style={{ borderColor: LINE }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-4 py-2 text-[12px] font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
          >
            Cancel
          </button>
          <ActionButton
            label={isEditing ? "Save Changes" : "Create Workflow"}
            onClick={() => void handleSave()}
            icon={isEditing ? Gear : ArrowsClockwise}
            tone="accent"
            loading={saving}
            disabled={!form.name.trim()}
          />
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  WorkflowsPanel                                                      */
/* ------------------------------------------------------------------ */

function WorkflowsPanel({
  workflows,
  companyId,
  onRefresh,
}: {
  workflows: WorkflowPipelineRecord[]
  companyId: string
  onRefresh: () => void
}) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowPipelineRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkflowPipelineRecord | null>(null)

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    await window.agentCompany.deleteWorkflow({
      id: deleteTarget.id,
      companyId,
    })
    setDeleteTarget(null)
    onRefresh()
  }, [deleteTarget, companyId, onRefresh])

  const counts = useMemo(() => ({
    total: workflows.length,
    active: workflows.filter((w) => w.status === "active").length,
    draft: workflows.filter((w) => w.status === "draft").length,
  }), [workflows])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: `${ACCENT}12`, color: ACCENT }}
          >
            <ArrowsClockwise size={20} weight="fill" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[color:var(--text)]">Workflow Pipelines</h2>
            <p className="text-[12px] text-[color:var(--muted)]">
              {counts.active} active, {counts.draft} draft{counts.total > counts.active + counts.draft ? `, ${counts.total - counts.active - counts.draft} other` : ""}
            </p>
          </div>
        </div>
        <ActionButton
          label="New Workflow"
          onClick={() => setShowCreateModal(true)}
          icon={Plus}
          tone="accent"
        />
      </div>

      {/* Workflow list */}
      {workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed py-16 text-center" style={{ borderColor: LINE }}>
          <ArrowsClockwise size={36} className="mb-3 text-[color:var(--muted)]" />
          <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">No workflow pipelines</div>
          <div className="mx-auto mt-1 max-w-[42ch] text-[12px] leading-relaxed text-[color:var(--muted)]">
            Workflows are multi-step automation pipelines. They chain actions together so your AI company runs end-to-end processes automatically.
          </div>
          <div className="mt-4">
            <ActionButton
              label="Create First Workflow"
              onClick={() => setShowCreateModal(true)}
              icon={ArrowsClockwise}
              tone="accent"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {workflows.map((wf) => (
              <WorkflowCard
                key={wf.id}
                workflow={wf}
                onDelete={() => setDeleteTarget(wf)}
                onEdit={() => setEditingWorkflow(wf)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Create / Edit modal */}
      <AnimatePresence>
        {showCreateModal ? (
          <WorkflowFormModal
            open={showCreateModal}
            editingWorkflow={null}
            companyId={companyId}
            onClose={() => setShowCreateModal(false)}
            onSaved={onRefresh}
          />
        ) : null}
        {editingWorkflow ? (
          <WorkflowFormModal
            open={!!editingWorkflow}
            editingWorkflow={editingWorkflow}
            companyId={companyId}
            onClose={() => setEditingWorkflow(null)}
            onSaved={onRefresh}
          />
        ) : null}
      </AnimatePresence>

      {/* Delete confirmation */}
      <AnimatePresence>
        {deleteTarget ? (
          <DeleteConfirmDialog
            open={!!deleteTarget}
            entityName={deleteTarget.name}
            onConfirm={() => void handleDelete()}
            onCancel={() => setDeleteTarget(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Automation Panel (exported)                                    */
/* ------------------------------------------------------------------ */

interface AutomationPanelProps {
  rules: AutomationRuleRecord[]
  workflows: WorkflowPipelineRecord[]
  agents: AgentRecord[]
  companyId: string
  onRefresh: () => void
}

export function AutomationPanel({
  rules,
  workflows,
  agents,
  companyId,
  onRefresh,
}: AutomationPanelProps) {
  const [activeSection, setActiveSection] = useState<"rules" | "workflows">("rules")

  return (
    <div className="space-y-6">
      {/* Top banner */}
      <div
        className="rounded-[12px] border px-5 py-4"
        style={{
          borderColor: `${ACCENT}30`,
          background: `linear-gradient(135deg, ${ACCENT}08 0%, ${ACCENT}04 100%)`,
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]"
            style={{ backgroundColor: `${ACCENT}18`, color: ACCENT }}
          >
            <Robot size={20} weight="fill" />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-[color:var(--text)]">Automation Engine</div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--muted)]">
              Rules trigger actions based on company events. Workflows chain multiple steps into pipelines.
              Together, they let your AI company run fully autonomously -- responding to changes, routing work,
              and keeping every department in sync without manual intervention.
            </div>
          </div>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 rounded-[10px] bg-[color:var(--panel-soft)] p-1">
        <button
          type="button"
          onClick={() => setActiveSection("rules")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-[8px] px-4 py-2 text-[13px] font-medium transition ${
            activeSection === "rules"
              ? "bg-[color:var(--panel)] text-[color:var(--text)] shadow-sm"
              : "text-[color:var(--muted)] hover:text-[color:var(--text)]"
          }`}
        >
          <Lightning size={15} weight={activeSection === "rules" ? "fill" : "regular"} style={activeSection === "rules" ? { color: ACCENT } : undefined} />
          Automation Rules ({rules.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("workflows")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-[8px] px-4 py-2 text-[13px] font-medium transition ${
            activeSection === "workflows"
              ? "bg-[color:var(--panel)] text-[color:var(--text)] shadow-sm"
              : "text-[color:var(--muted)] hover:text-[color:var(--text)]"
          }`}
        >
          <ArrowsClockwise size={15} weight={activeSection === "workflows" ? "fill" : "regular"} style={activeSection === "workflows" ? { color: ACCENT } : undefined} />
          Workflows ({workflows.length})
        </button>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {activeSection === "rules" ? (
            <AutomationRulesPanel
              rules={rules}
              companyId={companyId}
              onRefresh={onRefresh}
            />
          ) : (
            <WorkflowsPanel
              workflows={workflows}
              companyId={companyId}
              onRefresh={onRefresh}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
