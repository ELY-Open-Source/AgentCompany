import { describe, expect, test } from "vitest";
import { stopAllRunsAndWait, untilStopped, withRunControl } from "../../src/main/services/run-control";

describe("run control", () => {
  test("shutdown stops every run and waits until each has recorded its ending", async () => {
    const recorded: string[] = [];
    const session = (id: string) => withRunControl(id, async () => {
      try {
        await untilStopped(new Promise<never>(() => {}));
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        recorded.push(`${id}: ${(error as Error).message}`);
        throw error;
      }
    });
    const runs = [session("run_a"), session("run_b")].map((run) => run.catch(() => undefined));
    expect(await stopAllRunsAndWait("The app was closing.", 2_000)).toBe(0);
    expect(recorded.sort()).toEqual(["run_a: The app was closing.", "run_b: The app was closing."]);
    await Promise.all(runs);
  });

  test("a run that ignores the stop is reported as unsettled after the grace period", async () => {
    let release = () => {};
    const stubborn = withRunControl("run_stubborn", () => new Promise<void>((resolve) => { release = resolve; }));
    expect(await stopAllRunsAndWait("The app was closing.", 30)).toBe(1);
    release();
    await stubborn;
  });
});
