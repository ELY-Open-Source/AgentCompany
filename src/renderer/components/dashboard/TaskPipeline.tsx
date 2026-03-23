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
      { label: "Backlog", count: counts.backlog, tone: "text-[color:var(--muted)]", bg: "bg-[color:var(--panel-soft)]" },
      { label: "Todo", count: counts.todo, tone: "text-[color:var(--warn)]", bg: "bg-[color:var(--warn-soft)]" },
      { label: "In Progress", count: counts.in_progress, tone: "text-[color:var(--accent)]", bg: "bg-[color:var(--accent-soft)]" },
      { label: "In Review", count: counts.in_review, tone: "text-[color:var(--warn)]", bg: "bg-[color:var(--warn-soft)]" },
      { label: "Done", count: counts.done, tone: "text-[color:var(--success)]", bg: "bg-[color:var(--success-soft)]" },
      { label: "Blocked", count: counts.blocked, tone: "text-[color:var(--danger)]", bg: "bg-[color:var(--danger-soft)]" },
    ];
  }, [tasks]);

  return (
    <div className="flex items-center gap-1.5">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex items-center gap-1.5">
          <div className={`flex items-center gap-2 rounded-[8px] px-3 py-2 ${stage.bg}`}>
            <span className={`text-[18px] font-bold ${stage.tone}`} style={{ fontVariantNumeric: "tabular-nums" }}>{stage.count}</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[color:var(--muted)]">{stage.label}</span>
          </div>
          {i < stages.length - 1 ? (
            <ArrowRight size={12} className="text-[color:var(--muted)]" />
          ) : null}
        </div>
      ))}
    </div>
  );
}
