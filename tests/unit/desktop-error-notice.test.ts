import type { DesktopResult } from "@shared/contracts";
import { describe, expect, it } from "vitest";
import {
  createAppErrorNotice,
  describeDesktopError,
  DesktopError,
  formatDesktopResultError,
  normalizeAppErrorNotice,
  unwrap,
} from "../../src/renderer/lib/desktop";

describe("renderer desktop error notices", () => {
  it("keeps DesktopResult error codes when unwrap throws", () => {
    const result: DesktopResult<string> = {
      ok: false,
      error: {
        code: "CONNECTOR_MODEL_NOT_ALLOWED",
        message: "The assigned agent model is disabled.",
      },
    };

    expect(() => unwrap(result)).toThrow(DesktopError);

    try {
      unwrap(result);
      throw new Error("unwrap should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DesktopError);
      expect((error as DesktopError).code).toBe("CONNECTOR_MODEL_NOT_ALLOWED");
      expect((error as DesktopError).message).toBe("The assigned agent model is disabled.");
    }
  });

  it("turns IPC error envelopes into actionable notices", () => {
    const notice = formatDesktopResultError({
      code: "CONNECTOR_MODEL_NOT_ALLOWED",
      message: "The assigned agent model is disabled or invalid for its connector.",
    });

    expect(notice).toEqual({
      code: "CONNECTOR_MODEL_NOT_ALLOWED",
      message: "The assigned agent model is disabled or invalid for its connector.",
      actionHint: "Open Connectors, enable an allowed model, then retry the run.",
    });
  });

  it("describes thrown DesktopError instances with their original code", () => {
    const notice = describeDesktopError(new DesktopError("TASK_UNASSIGNED", "Assign an agent before starting a run."));

    expect(notice).toEqual({
      code: "TASK_UNASSIGNED",
      message: "Assign an agent before starting a run.",
      actionHint: "Assign an agent to the task, then start the run.",
    });
  });

  it("normalizes local string errors into action-required notices", () => {
    expect(normalizeAppErrorNotice("Select a company before starting a run.")).toEqual({
      code: "ACTION_REQUIRED",
      message: "Select a company before starting a run.",
      actionHint: "Complete the required selection, then retry the action.",
    });
  });

  it("preserves explicit local action hints", () => {
    expect(
      createAppErrorNotice(
        "Select a company before starting a run.",
        "COMPANY_REQUIRED",
        "Select a company in the sidebar, then start the run.",
      ),
    ).toEqual({
      code: "COMPANY_REQUIRED",
      message: "Select a company before starting a run.",
      actionHint: "Select a company in the sidebar, then start the run.",
    });
  });
});
