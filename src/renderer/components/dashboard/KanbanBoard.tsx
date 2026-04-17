import { useMemo } from "react";
import { Briefcase, Robot } from "../ui/icons";
import type { AgentRecord, RunRecord, TaskRecord } from "@shared/types";
import { useT } from "../../i18n";
import { Eyebrow } from "../ui";

interface KanbanProps {
  tasks: TaskRecord[];
  agents: AgentRecord[];
  runs: RunRecord[];
  onSelectTask: (taskId: string) => void;
}

const KANBAN_COLUMNS: Array<{ status: TaskRecord["status"]; labelKey: string; tone: string; dotColor: string }> = [
  { status: "backlog", labelKey: "kanban.backlog", tone: "text-muted-foreground", dotColor: "bg-[color:var(--muted-foreground)]" },
  { status: "todo", labelKey: "kanban.todo", tone: "text-warning", dotColor: "bg-warning" },
  { status: "in_progress", labelKey: "kanban.inProgress", tone: "text-primary", dotColor: "bg-primary" },
  { status: "in_review", labelKey: "kanban.inReview", tone: "text-warning", dotColor: "bg-warning" },
  { status: "done", labelKey: "kanban.done", tone: "text-success", dotColor: "bg-success" },
  { status: "blocked", labelKey: "kanban.blocked", tone: "text-destructive", dotColor: "bg-destructive" },
];

const priorityColors: Record<string, string> = {
  critical: "border-l-[color:var(--destructive)]",
  high: "border-l-[color:var(--destructive)]",
  medium: "border-l-[color:var(--primary)]",
  low: "border-l-[color:var(--muted-foreground)]",
};

export function KanbanBoard({ tasks, agents, runs, onSelectTask }: KanbanProps) {
  const t = useT();
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
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
        <Briefcase size={32} className="mb-3 text-muted-foreground" />
        <div className="text-[14px] font-medium text-muted-foreground">{t("kanban.noTasks")}</div>
        <div className="mt-1 text-[12px] text-muted-foreground">{t("kanban.noTasksDetail")}</div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {KANBAN_COLUMNS.map((col) => {
        const colTasks = tasksByStatus[col.status] ?? [];
        return (
          <div key={col.status} className="flex w-[220px] min-w-[160px] shrink-0 flex-col lg:w-[240px]">
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className={`h-2.5 w-2.5 rounded-full ${col.dotColor}`} aria-hidden="true" />
              <Eyebrow className={col.tone}>{t(col.labelKey)}</Eyebrow>
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                {colTasks.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1.5 rounded-lg bg-muted p-1.5" style={{ minHeight: 120 }}>
              {colTasks.map((task) => {
                const assignee = agents.find((a) => a.id === task.assigneeAgentId);
                const activeRun = runs.find((r) => r.id === task.activeRunId);
                const isRunning = activeRun?.status === "running";
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onSelectTask(task.id)}
                    className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg border border-l-[3px] border-border bg-card px-3 py-2.5 text-left transition duration-150 hover:shadow-sm ${priorityColors[task.priority] ?? ""}`}
                  >
                    <div className="truncate text-[12px] font-medium leading-snug text-foreground">{task.title}</div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {assignee ? (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Robot size={10} />
                          {assignee.name}
                        </span>
                      ) : (
                        <span className="text-[10px] italic text-muted-foreground">{t("kanban.unassigned")}</span>
                      )}
                      {isRunning ? (
                        <span className="flex items-center gap-1 whitespace-nowrap text-[10px] text-success">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" aria-hidden="true" />
                          {t("kanban.running")}
                        </span>
                      ) : null}
                    </div>
                    {task.priority === "critical" || task.priority === "high" ? (
                      <div className={`mt-1 text-[9px] font-bold uppercase tracking-[0.12em] ${task.priority === "critical" ? "text-destructive" : "text-warning"}`}>
                        {task.priority === "critical" ? t("kanban.priority.critical") : t("kanban.priority.high")}
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
