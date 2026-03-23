import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CalendarCheck, Clock } from "@phosphor-icons/react";
import type { SprintRecord, TaskRecord } from "@shared/types";
import { StatusPill } from "../ui";

export function SprintProgress({ sprint, tasks }: { sprint: SprintRecord; tasks: TaskRecord[] }) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  const progress = useMemo(() => {
    if (sprint.velocityPoints === 0) return 0;
    return Math.min(100, Math.round((sprint.completedPoints / sprint.velocityPoints) * 100));
  }, [sprint]);

  const daysLeft = useMemo(() => {
    const end = new Date(sprint.endDate).getTime();
    const now = nowMs ?? end;
    return Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
  }, [sprint, nowMs]);

  const sprintTasks = useMemo(() => {
    const done = tasks.filter((t) => t.status === "done").length;
    const active = tasks.filter((t) => t.status === "in_progress" || t.status === "in_review").length;
    const total = tasks.length;
    return { done, active, total };
  }, [tasks]);

  return (
    <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarCheck size={16} className="text-[color:var(--accent)]" />
          <span className="truncate text-[12px] font-semibold text-[color:var(--text)]">{sprint.name}</span>
          <StatusPill status={sprint.status} />
        </div>
        <div className="flex items-center gap-1 text-[11px] text-[color:var(--muted)]">
          <Clock size={12} />
          {daysLeft} days left
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
        <motion.div
          className="h-full rounded-full bg-[color:var(--accent)]"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-[color:var(--muted)]">
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{sprint.completedPoints}/{sprint.velocityPoints} points ({progress}%)</span>
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-[color:var(--success)]">{sprintTasks.done} done</span>
          <span className="whitespace-nowrap text-[color:var(--accent)]">{sprintTasks.active} active</span>
          <span className="whitespace-nowrap">{sprintTasks.total} total</span>
        </div>
      </div>

      {sprint.goal && (
        <div className="mt-2 text-[11px] italic text-[color:var(--muted)]">"{sprint.goal}"</div>
      )}
    </div>
  );
}
