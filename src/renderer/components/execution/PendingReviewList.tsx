import { Robot } from "@phosphor-icons/react"
import type { AgentRecord, TaskRecord } from "@shared/types"
import { useT } from "../../i18n"
import { EmptyState, ListFrame } from "../ui"

export function PendingReviewList({ tasks, agents }: { tasks: TaskRecord[]; agents: AgentRecord[] }) {
  const t = useT()
  const reviewTasks = tasks.filter((tk) => tk.status === "in_review")
  if (reviewTasks.length === 0) return <EmptyState title={t("exec.noReviewsInProgress")} detail={t("exec.noReviewsDetail")} />
  return (
    <ListFrame>
      {reviewTasks.map((task) => {
        const assignee = agents.find((a) => a.id === task.assigneeAgentId) ?? null
        const reviewer = assignee?.reportsTo ? (agents.find((a) => a.id === assignee.reportsTo) ?? null) : null
        return (
          <div key={task.id} className="flex items-start gap-3 border-b border-[color:var(--line)] px-4 py-3 last:border-b-0">
            <Robot size={16} weight="fill" className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{task.title}</div>
              <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">{assignee ? assignee.name : "Unassigned"}{reviewer ? <> &rarr; reviewed by <span className="text-[color:var(--muted-strong)]">{reviewer.name}{reviewer.title ? ` (${reviewer.title})` : ""}</span></> : " · awaiting review"}</div>
            </div>
          </div>
        )
      })}
    </ListFrame>
  )
}
