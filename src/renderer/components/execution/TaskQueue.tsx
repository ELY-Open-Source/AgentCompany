import type { RunRecord, TaskRecord } from "@shared/types"
import { useT } from "../../i18n"
import { EmptyState, ListFrame, StatusPill } from "../ui"
import { PriorityDot } from "./execution-utils"

export function TaskQueue({ tasks, runs, selectedTaskId, onSelect }: { tasks: TaskRecord[]; runs: RunRecord[]; selectedTaskId: string | null; onSelect: (taskId: string) => void }) {
  const t = useT()
  if (tasks.length === 0) return <EmptyState title={t("exec.taskQueueEmpty")} />
  return (
    <ListFrame>
      {tasks.map((task) => {
        const activeRun = runs.find((run) => run.id === task.activeRunId) ?? null
        return (
          <button key={task.id} className={`focus-ring relative w-full border-b border-[color:var(--line)] px-5 py-4 text-left transition last:border-b-0 ${selectedTaskId === task.id ? "bg-transparent" : "bg-transparent hover:bg-[color:var(--panel-soft)]"}`} onClick={() => onSelect(task.id)}>
            {selectedTaskId === task.id ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-[color:var(--accent)]" /> : null}
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <PriorityDot priority={task.priority} />
                <div className={`truncate text-[14px] text-[color:var(--text)] ${selectedTaskId === task.id ? "font-semibold" : "font-medium"}`}>{task.title}</div>
              </div>
              <StatusPill status={activeRun?.status ?? task.status} />
            </div>
          </button>
        )
      })}
    </ListFrame>
  )
}
