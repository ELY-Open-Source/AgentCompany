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
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarCheck size={16} className="text-primary" />
          <span className="truncate text-[12px] font-semibold text-foreground">{sprint.name}</span>
          <StatusPill status={sprint.status} />
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock size={12} />
          {daysLeft} days left
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{sprint.completedPoints}/{sprint.velocityPoints} points ({progress}%)</span>
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-green-600 dark:text-green-400">{sprintTasks.done} done</span>
          <span className="whitespace-nowrap text-primary">{sprintTasks.active} active</span>
          <span className="whitespace-nowrap">{sprintTasks.total} total</span>
        </div>
      </div>

      {sprint.goal && (
        <div className="mt-2 text-[11px] italic text-muted-foreground">"{sprint.goal}"</div>
      )}
    </div>
  );
}
