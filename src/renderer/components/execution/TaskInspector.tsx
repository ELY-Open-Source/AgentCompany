import { useEffect, useMemo, useState, type ReactNode } from "react"
import type {
  CommentRecord, GoalRecord, ProfileSnapshot, ProjectRecord, RunRecord,
  TaskRecord, TaskStatus, WorkspaceRecord,
} from "@shared/types"
import { useT } from "../../i18n"
import { unwrap } from "../../lib/desktop"
import { ConfirmDialog, InlineNotice } from "../ui"
import { describeActionError, shouldAlertGovernance, type GovernanceAlert } from "./execution-utils"
import { TaskInspectorOverview } from "./TaskInspectorOverview"
import { TaskInspectorSubtasks } from "./TaskInspectorSubtasks"
import { TaskInspectorActivity } from "./TaskInspectorActivity"
import { TaskInspectorGovernance } from "./TaskInspectorGovernance"
import { TaskInspectorEditForm } from "./TaskInspectorEditForm"
import { useAppStore } from "../../state/store"
import type { TaskInspectorTab } from "../../state/slices/ui"

function alertTone(alerts: GovernanceAlert[]): "danger" | "warn" {
  return alerts.some((a) => a.severity === "danger") ? "danger" : "warn"
}

function alertMessage(alerts: GovernanceAlert[], t: (key: string, fallback?: string) => string): string {
  const parts = alerts.map((a) => {
    if (a.kind === "blocked") return t("exec.alertBlocked", "Blocked — needs unblock approval")
    if (a.kind === "budget_over") return t("exec.alertBudgetOver", "Assignee budget > 80%")
    return t("exec.alertMissingReviewer", "In review without a reviewer")
  })
  return parts.join(" · ")
}

export function TaskInspector({
  task, tasks, runs, agents, goals, projects, workspaces, companyId,
  onRun, onCancelRun, onCreateApproval, onOpenDiscussion,
  comments, onRefresh, onDeleted,
}: {
  task: TaskRecord
  tasks: TaskRecord[]
  runs: RunRecord[]
  agents: ProfileSnapshot["agents"]
  goals: GoalRecord[]
  projects: ProjectRecord[]
  workspaces: WorkspaceRecord[]
  companyId: string
  onRun: (taskId: string) => Promise<void>
  onCancelRun: (runId: string) => Promise<void>
  onCreateApproval: () => Promise<void>
  onOpenDiscussion: (taskId: string) => void
  comments: CommentRecord[]
  onRefresh: () => Promise<void>
  onDeleted: () => Promise<void>
}) {
  const t = useT()
  const addToast = useAppStore((s) => s.addToast)
  const tab = useAppStore((s) => s.taskInspectorTab)
  const setTab = useAppStore((s) => s.setTaskInspectorTab)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState<TaskStatus | null>(null)
  const [creatingApproval, setCreatingApproval] = useState(false)

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const assignee = agentMap.get(task.assigneeAgentId ?? "") ?? null
  const project = projects.find((p) => p.id === task.projectId) ?? null
  const goal = goals.find((g) => g.id === task.goalId) ?? null
  const workspace = workspaces.find((w) => w.id === task.workspaceId) ?? null
  const activeRun = runs.find((r) => r.id === task.activeRunId) ?? null
  const reviewer = assignee?.reportsTo ? agentMap.get(assignee.reportsTo) ?? null : null

  const subtasksCount = tasks.filter((s) => s.parentId === task.id).length
  const commentsCount = comments.length
  const runsCount = runs.length
  const alerts = useMemo(
    () => shouldAlertGovernance(task, assignee, reviewer),
    [task, assignee, reviewer],
  )

  // If the currently-selected tab disappears (e.g. Subtasks hidden because
  // subtasksCount===0), fall back to Overview so the modal never shows a
  // blank body. Keeps the persisted tab sticky in all other cases.
  useEffect(() => {
    if (tab === "subtasks" && subtasksCount === 0) setTab("overview")
  }, [tab, subtasksCount, setTab])

  async function quickStatus(status: TaskStatus) {
    setActionError(null); setActionNotice(null); setUpdatingStatus(status)
    try {
      unwrap(await window.agentCompany.saveTask({
        id: task.id, companyId: task.companyId, title: task.title, description: task.description,
        priority: task.priority, status, assigneeAgentId: task.assigneeAgentId,
        workspaceId: task.workspaceId, projectId: task.projectId, goalId: task.goalId,
      }))
      await onRefresh()
      setActionNotice(`Task moved to ${status.replaceAll("_", " ")}.`)
    } catch (e) {
      setActionError(describeActionError(e))
    } finally {
      setUpdatingStatus(null)
    }
  }

  async function handleCreateApproval() {
    setActionError(null); setActionNotice(null); setCreatingApproval(true)
    try {
      await onCreateApproval()
      setActionNotice(task.status === "blocked" ? "Approval created and routed to leadership." : "Approval created.")
      addToast("Approval created and routed to leadership", "success")
    } catch (e) {
      setActionError(describeActionError(e))
    } finally {
      setCreatingApproval(false)
    }
  }

  async function handleDelete() {
    setDeleteError(null)
    try {
      unwrap(await window.agentCompany.deleteTask({ id: task.id, companyId }))
      setConfirmDelete(false)
      addToast("Task deleted", "success")
      await onDeleted()
    } catch (e) {
      setDeleteError(describeActionError(e))
    }
  }

  const tabBtn = (key: TaskInspectorTab, label: string, badge?: ReactNode) => {
    const active = tab === key
    return (
      <button
        type="button"
        onClick={() => setTab(key)}
        className={`relative flex items-center rounded-md px-3 py-1.5 text-[12px] font-semibold transition ${
          active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
        {badge}
      </button>
    )
  }

  const countPill = (value: number) => (
    <span className={`ml-1 rounded-full px-1.5 text-[10px] ${tab === "activity" ? "bg-primary-foreground/20" : "bg-muted-foreground/15"}`}>{value}</span>
  )

  // Activity badge is a single total. The comments/runs split lives inside
  // the Activity tab as filter chips — one signal per surface.
  const activityBadge = commentsCount + runsCount > 0 ? countPill(commentsCount + runsCount) : null

  // Governance signal speaks once via the Overview banner. No tab-level dot —
  // duplicating the alert adds noise without context.

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={confirmDelete}
        title={t("exec.deleteTask")}
        message={t("exec.deleteTaskConfirm").replace("{0}", task.title)}
        errorMessage={deleteError}
        onConfirm={() => void handleDelete()}
        onCancel={() => { setDeleteError(null); setConfirmDelete(false) }}
      />

      {actionError ? <InlineNotice message={actionError} /> : null}
      {!actionError && actionNotice ? <InlineNotice message={actionNotice} tone="success" /> : null}

      {editing ? (
        <TaskInspectorEditForm
          task={task}
          agents={agents}
          goals={goals}
          projects={projects}
          workspaces={workspaces}
          onDone={() => setEditing(false)}
          onRefresh={onRefresh}
          onError={setActionError}
          onNotice={setActionNotice}
          addToast={addToast}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
            {tabBtn("overview", t("exec.tabOverview", "Overview"))}
            {subtasksCount > 0 && tabBtn("subtasks", t("exec.tabSubtasks", "Subtasks"), countPill(subtasksCount))}
            {tabBtn("activity", t("exec.tabActivity", "Activity"), activityBadge)}
            {tabBtn("governance", t("exec.tabGovernance", "Governance"))}
          </div>

          {tab === "overview" && (
            <>
              {alerts.length > 0 ? (
                <InlineNotice
                  tone={alertTone(alerts)}
                  message={alertMessage(alerts, t)}
                  action={
                    <button
                      type="button"
                      onClick={() => setTab("governance")}
                      className="shrink-0 rounded-md border border-current px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                    >
                      {t("exec.openGovernance", "Open")}
                    </button>
                  }
                />
              ) : null}
              <TaskInspectorOverview
                task={task}
                tasks={tasks}
                activeRun={activeRun}
                assignee={assignee}
                project={project}
                goal={goal}
                workspace={workspace}
                onRun={onRun}
                onCancelRun={onCancelRun}
                onQuickStatus={quickStatus}
                onOpenDiscussion={onOpenDiscussion}
                onEdit={() => { setActionError(null); setActionNotice(null); setEditing(true) }}
                onDelete={() => setConfirmDelete(true)}
                updatingStatus={updatingStatus}
              />
            </>
          )}

          {tab === "subtasks" && subtasksCount > 0 && (
            <TaskInspectorSubtasks task={task} tasks={tasks} agents={agents} />
          )}

          {tab === "activity" && (
            <TaskInspectorActivity
              taskId={task.id}
              companyId={task.companyId}
              agents={agents}
              comments={comments}
              runs={runs}
              onRefresh={onRefresh}
            />
          )}

          {tab === "governance" && (
            <TaskInspectorGovernance
              task={task}
              assignee={assignee}
              reviewer={reviewer}
              onCreateApproval={handleCreateApproval}
              creatingApproval={creatingApproval}
            />
          )}
        </>
      )}
    </div>
  )
}
