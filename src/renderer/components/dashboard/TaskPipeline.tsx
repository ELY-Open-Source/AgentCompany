import { useMemo } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import type { TaskRecord } from "@shared/types";

export function TaskPipeline({ tasks }: { tasks: TaskRecord[] }) {
  const stages = useMemo(() => {
    const counts = { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0, blocked: 0 };
    for (const t of tasks) {
      if (t.status in counts) counts[t.status as keyof typeof counts]++;
    }
    return [
      { label: "Backlog", count: counts.backlog, tone: "text-muted-foreground", bg: "bg-muted" },
      { label: "Todo", count: counts.todo, tone: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-100 dark:bg-yellow-900/50" },
      { label: "In Progress", count: counts.in_progress, tone: "text-primary", bg: "bg-accent" },
      { label: "In Review", count: counts.in_review, tone: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-100 dark:bg-yellow-900/50" },
      { label: "Done", count: counts.done, tone: "text-green-600 dark:text-green-400", bg: "bg-green-100 dark:bg-green-900/50" },
      { label: "Blocked", count: counts.blocked, tone: "text-destructive", bg: "bg-red-100 dark:bg-red-900/50" },
    ];
  }, [tasks]);

  return (
    <div className="flex items-center gap-1.5">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex items-center gap-1.5">
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${stage.bg}`}>
            <span className={`text-[18px] font-bold ${stage.tone}`} style={{ fontVariantNumeric: "tabular-nums" }}>{stage.count}</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{stage.label}</span>
          </div>
          {i < stages.length - 1 ? (
            <ArrowRight size={12} className="text-muted-foreground" />
          ) : null}
        </div>
      ))}
    </div>
  );
}
