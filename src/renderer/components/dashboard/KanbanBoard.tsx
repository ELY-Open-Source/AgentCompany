import { useMemo } from "react";
import { Briefcase, Robot } from "@phosphor-icons/react";
import type { AgentRecord, RunRecord, TaskRecord } from "@shared/types";

interface KanbanProps {
  tasks: TaskRecord[];
  agents: AgentRecord[];
  runs: RunRecord[];
  onSelectTask: (taskId: string) => void;
}

const KANBAN_COLUMNS: Array<{ status: TaskRecord["status"]; label: string; tone: string; dotColor: string }> = [
  { status: "backlog", label: "Backlog", tone: "text-[color:var(--muted)]", dotColor: "bg-[color:var(--muted)]" },
  { status: "todo", label: "Todo", tone: "text-[color:var(--warn)]", dotColor: "bg-[color:var(--warn)]" },
  { status: "in_progress", label: "In Progress", tone: "text-[color:var(--accent)]", dotColor: "bg-[color:var(--accent)]" },
  { status: "in_review", label: "In Review", tone: "text-[color:var(--warn)]", dotColor: "bg-[color:var(--warn)]" },
  { status: "done", label: "Done", tone: "text-[color:var(--success)]", dotColor: "bg-[color:var(--success)]" },
  { status: "blocked", label: "Blocked", tone: "text-[color:var(--danger)]", dotColor: "bg-[color:var(--danger)]" },
];

const priorityColors: Record<string, string> = {
  critical: "border-l-[color:var(--danger)]",
  high: "border-l-[color:var(--warn)]",
  medium: "border-l-[color:var(--accent)]",
  low: "border-l-[color:var(--muted)]",
};

export function KanbanBoard({ tasks, agents, runs, onSelectTask }: KanbanProps) {
  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, TaskRecord[]> = {};
    for (const col of KANBAN_COLUMNS) grouped[col.status] = [];
    for (const task of tasks) {
      if (task.status === "cancelled") continue;
      const bucket = grouped[task.status];
      if (bucket) bucket.push(task);
      else grouped.backlog?.push(task);
    }
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    for (const col of Object.values(grouped)) {
      col.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));
    }
    return grouped;
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-[color:var(--line)] py-16 text-center">
        <Briefcase size={32} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">No tasks yet</div>
        <div className="mt-1 text-[12px] text-[color:var(--muted)]">Tasks created by agents will appear here on the board</div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {KANBAN_COLUMNS.map((col) => {
        const colTasks = tasksByStatus[col.status] ?? [];
        return (
          <div key={col.status} className="flex w-[220px] min-w-[180px] shrink-0 flex-col">
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className={`h-2.5 w-2.5 rounded-full ${col.dotColor}`} aria-hidden="true" />
              <span className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${col.tone}`}>{col.label}</span>
              <span className="ml-auto rounded-full bg-[color:var(--panel-soft)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[color:var(--muted-strong)]">
                {colTasks.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1.5 rounded-[8px] bg-[color:var(--panel-soft)] p-1.5" style={{ minHeight: 120 }}>
              {colTasks.map((task) => {
                const assignee = agents.find((a) => a.id === task.assigneeAgentId);
                const activeRun = runs.find((r) => r.id === task.activeRunId);
                const isRunning = activeRun?.status === "running";
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onSelectTask(task.id)}
                    className={`focus-ring rounded-[6px] border border-l-[3px] border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2.5 text-left transition duration-150 hover:shadow-sm ${priorityColors[task.priority] ?? ""}`}
                  >
                    <div className="truncate text-[12px] font-medium leading-snug text-[color:var(--text)]">{task.title}</div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {assignee ? (
                        <span className="flex items-center gap-1 text-[10px] text-[color:var(--muted)]">
                          <Robot size={10} />
                          {assignee.name}
                        </span>
                      ) : (
                        <span className="text-[10px] italic text-[color:var(--muted)]">Unassigned</span>
                      )}
                      {isRunning ? (
                        <span className="flex items-center gap-1 whitespace-nowrap text-[10px] text-[color:var(--success)]">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--success)]" aria-hidden="true" />
                          Running
                        </span>
                      ) : null}
                    </div>
                    {task.priority === "critical" || task.priority === "high" ? (
                      <div className={`mt-1 text-[9px] font-bold uppercase tracking-[0.12em] ${task.priority === "critical" ? "text-[color:var(--danger)]" : "text-[color:var(--warn)]"}`}>
                        {task.priority}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
