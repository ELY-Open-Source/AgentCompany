import type { ProfileSnapshot, TaskRecord } from "@shared/types"
import { useT } from "../../i18n"
import { Eyebrow, StatusPill } from "../ui"
import { ListChecks } from "../ui/icons"

export function TaskInspectorSubtasks({ task, tasks, agents }: {
  task: TaskRecord; tasks: TaskRecord[]; agents: ProfileSnapshot["agents"]
}) {
  const t = useT()
  const subtasks = tasks.filter((s) => s.parentId === task.id)
  const agentMap = new Map(agents.map((a) => [a.id, a]))

  if (subtasks.length === 0) {
    return <div className="text-[13px] text-muted-foreground">{t("exec.noSubtasks", "No subtasks.")}</div>
  }

  const done = subtasks.filter((s) => s.status === "done").length
  const pct = (done / subtasks.length) * 100

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ListChecks size={14} className="text-muted-foreground" />
        <Eyebrow>{t("exec.subtasks")} ({subtasks.length})</Eyebrow>
        <span className="text-[10px] text-success">
          {t("exec.doneCount").replace("{0}", String(done)).replace("{1}", String(subtasks.length))}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-success transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="space-y-1">
        {subtasks.map((sub) => {
          const subAssignee = agentMap.get(sub.assigneeAgentId ?? "")
          return (
            <div key={sub.id} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] bg-muted">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sub.status === "done" ? "bg-success" : sub.status === "in_progress" ? "bg-primary" : sub.status === "blocked" ? "bg-destructive" : sub.status === "in_review" ? "bg-warning" : "bg-[color:var(--muted-foreground)]"}`} />
              <span className={`flex-1 truncate ${sub.status === "done" ? "line-through text-muted-foreground" : "text-foreground"}`}>{sub.title}</span>
              {subAssignee ? <span className="shrink-0 text-[10px] text-muted-foreground">{subAssignee.name}</span> : null}
              <StatusPill status={sub.status} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
