import { useMemo } from "react";
import { motion } from "framer-motion";
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
            className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 text-left transition hover:border-[color:var(--line-strong)]"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target size={14} className="text-[color:var(--accent)]" />
                <span className="text-[12px] font-medium text-[color:var(--text)]">{goal.title}</span>
              </div>
              <span className="text-[11px] font-bold text-[color:var(--accent)]">{pct}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
              <motion.div
                className="h-full rounded-full bg-[color:var(--accent)]"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <div className="mt-1 text-[10px] text-[color:var(--muted)]">{done}/{total} tasks complete</div>
          </button>
        );
      })}
    </div>
  );
}
