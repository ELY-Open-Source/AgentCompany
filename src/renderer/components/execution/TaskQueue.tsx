import { useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { RunRecord, TaskRecord } from "@shared/types"
import { useT } from "../../i18n"
import { useRovingTabIndex } from "../../lib/keyboard"
import { EmptyState, StatusPill } from "../ui"
import { PriorityDot } from "./execution-utils"

export function TaskQueue({ tasks, runs, selectedTaskId, onSelect }: { tasks: TaskRecord[]; runs: RunRecord[]; selectedTaskId: string | null; onSelect: (taskId: string) => void }) {
  const t = useT()
  const parentRef = useRef<HTMLDivElement>(null)
  const { handleKeyDown, getTabIndex, focusedIndex } = useRovingTabIndex(tasks.length)

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  })

  if (tasks.length === 0) return <EmptyState title={t("exec.taskQueueEmpty")} />
  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto border-y border-border"
      role="listbox"
      aria-label="Task queue"
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const task = tasks[virtualRow.index]
          const activeRun = runs.find((run) => run.id === task.activeRunId) ?? null
          return (
            <div
              key={task.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              tabIndex={getTabIndex(virtualRow.index)}
              role="option"
              aria-selected={task.id === selectedTaskId}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none ${virtualRow.index === focusedIndex ? "ring-1 ring-[color:var(--primary)] ring-inset" : ""}`}
            >
              <button
                className={`relative w-full border-b border-border px-4 py-3 text-left transition duration-150 last:border-b-0 ${selectedTaskId === task.id ? "bg-accent border-l-[3px] border-l-[color:var(--primary)]" : "bg-transparent hover:bg-muted"}`}
                onClick={() => onSelect(task.id)}
                tabIndex={-1}
              >
                {selectedTaskId === task.id ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-primary" /> : null}
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <PriorityDot priority={task.priority} />
                    <div className={`truncate text-[13px] text-foreground ${selectedTaskId === task.id ? "font-semibold" : "font-medium"}`}>{task.title}</div>
                  </div>
                  <StatusPill status={activeRun?.status ?? task.status} />
                </div>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
