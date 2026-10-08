import { describe, expect, test } from "vitest";
import { runBlocker } from "../../src/renderer/src/pages/work/task-helpers";
import type { ProviderRecord, TaskRecord, TaskRunRecord } from "../../src/shared/domain";

const provider = { enabled: true, authState: "configured" } as ProviderRecord;
const task = (status: TaskRecord["status"]) => ({ id: "tsk_1", status }) as TaskRecord;
const run = (state: string, taskId = "tsk_1") => ({ taskId, state }) as TaskRunRecord;

describe("run blocker", () => {
  test("a manual run needs a provider, an open task and no session in flight", () => {
    expect(runBlocker(task("in_progress"), provider, [run("completed"), run("running", "tsk_other")])).toBeNull();
    expect(runBlocker(task("in_progress"), null, [])).toBe("Connect a provider to run");
    expect(runBlocker(task("done"), provider, [])).toBe("Done tasks do not run");
    expect(runBlocker(task("backlog"), provider, [run("queued")])).toBe("A session is already queued or running");
    expect(runBlocker(task("review"), provider, [run("running")])).toBe("A session is already queued or running");
  });
});
