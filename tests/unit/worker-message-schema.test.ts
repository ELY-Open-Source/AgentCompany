import { describe, expect, it } from "vitest";
import { workerMessageSchema } from "../../src/main/worker/entry/types";

const RUN_ID = "00000000-0000-4000-8000-000000000001";

describe("worker message schema", () => {
  it("accepts run-finished messages keyed by usage status", () => {
    expect(
      workerMessageSchema.safeParse({
        type: "run-finished",
        runId: RUN_ID,
        status: "failed",
        summary: null,
        errorMessage: "Agent stopped with error.",
        exitCode: null,
        signal: null,
        model: "gpt-5.4",
        usageStatus: "error_stop",
        inputTokens: 12,
        outputTokens: 1,
      }).success,
    ).toBe(true);
  });

  it("rejects legacy unattributed-cost truth in run-finished messages", () => {
    expect(
      workerMessageSchema.safeParse({
        type: "run-finished",
        runId: RUN_ID,
        status: "failed",
        summary: null,
        errorMessage: "Agent stopped with error.",
        exitCode: null,
        signal: null,
        model: "gpt-5.4",
        usageStatus: "error_stop",
        unattributedCost: false,
        inputTokens: 12,
        outputTokens: 1,
      }).success,
    ).toBe(false);
  });
});
