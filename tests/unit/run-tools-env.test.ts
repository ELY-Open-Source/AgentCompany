import { describe, expect, it } from "vitest";

import { createRunScopedBashOptions } from "../../src/main/worker/runtime/run-tools";

describe("run-scoped bash environment", () => {
  it("merges run env into the spawned command environment", () => {
    const options = createRunScopedBashOptions({
      AGENT_COMPANY_RUN_ID: "run-a",
      AGENT_COMPANY_API_KEY: "secret-a",
    });

    const context = options.spawnHook?.({
      command: "env",
      cwd: "/tmp",
      env: {
        PATH: "/usr/bin",
        AGENT_COMPANY_RUN_ID: "base",
      },
    });

    expect(context?.env.PATH).toBe("/usr/bin");
    expect(context?.env.AGENT_COMPANY_RUN_ID).toBe("run-a");
    expect(context?.env.AGENT_COMPANY_API_KEY).toBe("secret-a");
  });

  it("keeps two run env hooks independent", () => {
    const runA = createRunScopedBashOptions({ AGENT_COMPANY_RUN_ID: "run-a" });
    const runB = createRunScopedBashOptions({ AGENT_COMPANY_RUN_ID: "run-b" });
    const base = { command: "env", cwd: "/tmp", env: { PATH: "/usr/bin" } };

    expect(runA.spawnHook?.(base).env.AGENT_COMPANY_RUN_ID).toBe("run-a");
    expect(runB.spawnHook?.(base).env.AGENT_COMPANY_RUN_ID).toBe("run-b");
  });

  it("freezes the env snapshot at factory creation", () => {
    const env = { AGENT_COMPANY_RUN_ID: "run-a" };
    const options = createRunScopedBashOptions(env);
    env.AGENT_COMPANY_RUN_ID = "mutated";

    const context = options.spawnHook?.({
      command: "env",
      cwd: "/tmp",
      env: {},
    });

    expect(context?.env.AGENT_COMPANY_RUN_ID).toBe("run-a");
  });
});
