import type { GoalRecord, TaskRecord } from "../../../../shared/domain";

/** How completion compares with the time elapsed toward the goal's target date. */
export type GoalPace = "ahead" | "on_track" | "behind" | "overdue";

/** Within this share of the plan either way, a goal is on track. */
const ON_TRACK_BAND = 0.1;

/** A goal's completion, and its pace only when it has a target date to measure against. */
export function goalProgress(goal: GoalRecord, tasks: TaskRecord[], now: Date): { percent: number; pace: GoalPace | null } {
  const scoped = tasks.filter((task) => task.goalId === goal.id);
  const done = scoped.filter((task) => task.status === "done").length;
  const percent = scoped.length === 0 ? 0 : Math.round((done / scoped.length) * 100);
  if (!goal.dueAt) return { percent, pace: null };
  const start = new Date(goal.createdAt).getTime();
  const due = new Date(goal.dueAt).getTime();
  // Counted, not rounded: 200 of 201 done is still unfinished past the date.
  if (now.getTime() > due && (scoped.length === 0 || done < scoped.length)) return { percent, pace: "overdue" };
  const expected = due <= start ? 1 : Math.min(1, Math.max(0, (now.getTime() - start) / (due - start)));
  const lead = percent / 100 - expected;
  return { percent, pace: lead >= ON_TRACK_BAND ? "ahead" : lead >= -ON_TRACK_BAND ? "on_track" : "behind" };
}
