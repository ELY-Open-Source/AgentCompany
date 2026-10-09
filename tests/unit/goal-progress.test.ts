import { describe, expect, test } from "vitest";
import { goalProgress } from "../../src/renderer/src/pages/home/goal-progress";
import type { GoalRecord, TaskRecord } from "../../src/shared/domain";

const goal = (dueAt: string | null) => ({ id: "gol_1", createdAt: "2026-01-01T00:00:00.000Z", dueAt }) as GoalRecord;
const tasks = (done: number, total: number) => Array.from({ length: total }, (_, index) => ({ goalId: "gol_1", status: index < done ? "done" : "in_progress" })) as TaskRecord[];

describe("goal progress", () => {
  test("without a target date it reports completion only, never a pace", () => {
    expect(goalProgress(goal(null), tasks(1, 4), new Date("2026-01-10T00:00:00.000Z"))).toEqual({ percent: 25, pace: null });
  });

  test("with a target date the pace compares completion with the time elapsed toward it", () => {
    const due = goal("2026-01-11T00:00:00.000Z");
    const day = (n: number) => new Date(`2026-01-${String(n).padStart(2, "0")}T00:00:00.000Z`);
    expect(goalProgress(due, tasks(1, 4), day(6))).toEqual({ percent: 25, pace: "behind" });
    expect(goalProgress(due, tasks(2, 4), day(6))).toEqual({ percent: 50, pace: "on_track" });
    expect(goalProgress(due, tasks(3, 4), day(6))).toEqual({ percent: 75, pace: "ahead" });
    expect(goalProgress(due, tasks(3, 4), day(12))).toEqual({ percent: 75, pace: "overdue" });
    expect(goalProgress(due, tasks(4, 4), day(12))).toEqual({ percent: 100, pace: "on_track" });
    // Counted, not rounded: one unfinished task of many is still overdue.
    expect(goalProgress(due, tasks(200, 201), day(12))).toEqual({ percent: 100, pace: "overdue" });
  });
});
