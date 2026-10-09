import { describe, expect, test } from "vitest";
import { newestRuns } from "../../src/renderer/src/pages/runs/newest-runs";

describe("the home page's recent runs", () => {
  test("are the newest ones, newest first, from the snapshot's oldest-first list", () => {
    const runs = Array.from({ length: 10 }, (_, index) => ({ id: `run_${index}` }));
    expect(newestRuns(runs, 3).map((run) => run.id)).toEqual(["run_9", "run_8", "run_7"]);
    expect(newestRuns(runs.slice(0, 2), 6).map((run) => run.id)).toEqual(["run_1", "run_0"]);
  });
});
