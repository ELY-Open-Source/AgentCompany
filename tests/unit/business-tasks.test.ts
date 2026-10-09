import { describe, expect, test } from "vitest";
import { isBusinessTask } from "../../src/renderer/src/pages/work/task-helpers";
import type { TaskRecord } from "../../src/shared/domain";

describe("what counts as work", () => {
  test("chat reply vehicles and goal checkpoints are not work; reviews of work and plain tasks are", () => {
    const task = (origin: TaskRecord["origin"]) => ({ origin }) as TaskRecord;
    expect([null, "task_review", "chat_wake", "goal_review"].map((origin) => isBusinessTask(task(origin as TaskRecord["origin"])))).toEqual([true, true, false, false]);
  });
});
