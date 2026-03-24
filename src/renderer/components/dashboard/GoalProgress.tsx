import { useMemo } from "react";
import { Target } from "@phosphor-icons/react";
import type { GoalRecord, SectionId, TaskRecord } from "@shared/types";

export function GoalProgress({ goals, tasks, onNavigate }: { goals: GoalRecord[]; tasks: TaskRecord[]; onNavigate: (section: SectionId) => void }) {
  const activeGoals = useMemo(() => goals.filter((g) => g.status === "active"), [goals]);

  if (activeGoals.length === 0) return null;

  return (
    <div className="space-y-2">
      {activeGoals.slice(0, 5).map((goal) => {
        const goalTasks = tasks.filter((t) => t.goalId === goal.id);
        const done = goalTasks.filter((t) => t.status === "done").length;
        const total = goalTasks.length;
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);

        return (
          <button
            key={goal.id}
            type="button"
            onClick={() => onNavigate("goals")}
            className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3.5 text-left transition hover:border-[color:var(--line-strong)] hover:shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Target size={15} weight="fill" className="shrink-0 text-[color:var(--accent)]" />
                <span className="truncate text-[13px] font-medium text-[color:var(--text)]">{goal.title}</span>
              </div>
              <span className="shrink-0 whitespace-nowrap text-[13px] font-bold tabular-nums text-[color:var(--accent)]">{pct}%</span>
            </div>
            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
              <div
                className="h-full rounded-full bg-[color:var(--accent)] transition-all duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1.5 text-[11px] text-[color:var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>{done}/{total} tasks complete</div>
          </button>
        );
      })}
    </div>
  );
}
