import { describe, expect, it } from "vitest";
import {
  classifyRunUsage,
  deriveLegacyRunUsageStatus,
  hasAttributableAssistantUsage,
  isUsageStatusUnattributed,
} from "../../src/main/run-usage-status";

describe("run usage status", () => {
  it("does not treat pi error EMPTY_USAGE as attributable cost", () => {
    expect(
      hasAttributableAssistantUsage({
        role: "assistant",
        stopReason: "error",
        usage: { input: 0, output: 0 },
      }),
    ).toBe(false);
  });

  it("accepts normal assistant usage as attributable", () => {
    expect(
      hasAttributableAssistantUsage({
        role: "assistant",
        stopReason: "stop",
        usage: { input: 12, output: 7 },
      }),
    ).toBe(true);
  });

  it("keeps non-zero terminal usage attributable", () => {
    expect(
      hasAttributableAssistantUsage({
        role: "assistant",
        stopReason: "error",
        usage: { input: 12, output: 1 },
      }),
    ).toBe(true);
  });

  it("classifies terminal usage states explicitly", () => {
    expect(
      classifyRunUsage({
        runStatus: "failed",
        errorMessage: "stream setup failed",
        sawAttributableUsage: false,
        terminalStopReason: "error",
      }),
    ).toBe("error_stop");

    expect(
      classifyRunUsage({
        runStatus: "cancelled",
        errorMessage: null,
        sawAttributableUsage: false,
        terminalStopReason: "aborted",
      }),
    ).toBe("aborted_before_usage");

    expect(
      classifyRunUsage({
        runStatus: "failed",
        errorMessage: "prepareRun failed",
        sawAttributableUsage: false,
        terminalStopReason: null,
      }),
    ).toBe("pre_first_message");

    expect(
      classifyRunUsage({
        runStatus: "succeeded",
        errorMessage: null,
        sawAttributableUsage: true,
        terminalStopReason: null,
      }),
    ).toBe("ok");
  });

  it("maps legacy finishRun inputs into explicit usage status", () => {
    expect(deriveLegacyRunUsageStatus({ runStatus: "succeeded", unattributedCost: false })).toBe("ok");
    expect(deriveLegacyRunUsageStatus({ runStatus: "interrupted", unattributedCost: true })).toBe(
      "aborted_before_usage",
    );
    expect(deriveLegacyRunUsageStatus({ runStatus: "failed", unattributedCost: true })).toBe("pre_first_message");
  });

  it("derives the legacy unattributed-cost flag from usage status", () => {
    expect(isUsageStatusUnattributed("ok")).toBe(false);
    expect(isUsageStatusUnattributed("pre_first_message")).toBe(true);
    expect(isUsageStatusUnattributed("error_stop")).toBe(true);
    expect(isUsageStatusUnattributed("aborted_before_usage")).toBe(true);
  });
});
