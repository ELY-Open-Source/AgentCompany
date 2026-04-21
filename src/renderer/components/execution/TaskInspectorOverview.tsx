import { CheckCircle, Pencil, Play, Trash, XCircle, ArrowRight } from "../ui/icons"
import type { GoalRecord, ProfileSnapshot, ProjectRecord, RunRecord, TaskRecord, TaskStatus, WorkspaceRecord } from "@shared/types"
import { useT } from "../../i18n"
import { formatMoney } from "../../lib/formatters"
import { ActionButton, StatusPill } from "../ui"

export function TaskInspectorOverview({
  task, tasks, activeRun, assignee, project, goal, workspace,
  onRun, onCancelRun, onQuickStatus, onOpenDiscussion, onEdit, onDelete, updatingStatus,
}: {
  task: TaskRecord
  tasks: TaskRecord[]
  activeRun: RunRecord | null
  assignee: ProfileSnapshot["agents"][number] | null
  project: ProjectRecord | null
  goal: GoalRecord | null
  workspace: WorkspaceRecord | null
  onRun: (taskId: string) => Promise<void>
  onCancelRun: (runId: string) => Promise<void>
  onQuickStatus: (status: TaskStatus) => Promise<void>
  onOpenDiscussion: (taskId: string) => void
  onEdit: () => void
  onDelete: () => void
  updatingStatus: TaskStatus | null
}) {
  const t = useT()
  const parent = task.parentId ? tasks.find((p) => p.id === task.parentId) ?? null : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={task.status} />
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {task.priority}
        </span>
        {assignee && <span className="text-[12px] text-muted-foreground">{t("exec.assigneeLabel")} <span className="text-foreground">{assignee.name}</span></span>}
      </div>

      <div className="grid gap-x-6 gap-y-1 text-[13px] md:grid-cols-2">
        {project && <div className="text-muted-foreground">{t("exec.projectLabel")} <span className="text-foreground">{project.name}</span></div>}
        {goal && <div className="text-muted-foreground">{t("exec.goalLabel")} <span className="text-foreground">{goal.title}</span></div>}
        {parent && <div className="text-muted-foreground">{t("exec.parentLabel")} <span className="text-foreground">{parent.title}</span></div>}
        {workspace && <div className="text-muted-foreground">{t("exec.workspaceLabel")} <span className="text-foreground">{workspace.name}</span></div>}
        {task.costUsd > 0 && <div className="text-muted-foreground">{t("exec.costLabel")} <span className="font-mono tabular-nums text-foreground">{formatMoney(task.costUsd)}</span></div>}
      </div>

      {task.description ? <div className="text-[13px] leading-relaxed text-muted-foreground whitespace-pre-wrap">{task.description}</div> : null}

      {/* Action row grouped by weight: primary (accent) · secondary (default) · destructive (danger).
          gap-6 between groups, gap-2 within a group — spacing does the tiering. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {activeRun ? (
            <ActionButton label={t("exec.cancelRun")} onClick={() => void onCancelRun(activeRun.id)} icon={XCircle} tone="danger" />
          ) : (
            <>
              {["todo", "in_progress", "blocked"].includes(task.status) && (
                <ActionButton label={t("exec.run")} onClick={() => void onRun(task.id)} icon={Play} tone="accent" />
              )}
              {task.status === "in_review" && (
                <ActionButton label={t("exec.done")} onClick={() => void onQuickStatus("done")} icon={CheckCircle} tone="accent" loading={updatingStatus === "done"} />
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!activeRun && task.status === "blocked" && (
            <ActionButton label={t("exec.unblock")} onClick={() => void onQuickStatus("in_progress")} icon={Play} loading={updatingStatus === "in_progress"} />
          )}
          <ActionButton label={t("exec.discussion")} onClick={() => onOpenDiscussion(task.id)} icon={ArrowRight} />
          <ActionButton label={t("exec.edit")} onClick={onEdit} icon={Pencil} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton label={t("exec.delete")} onClick={onDelete} icon={Trash} tone="danger" />
        </div>
      </div>
    </div>
  )
}
