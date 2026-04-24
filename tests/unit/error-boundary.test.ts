import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "../../src/renderer/components/ui";

describe("ErrorBoundary", () => {
  it("resets a captured page error when the section changes", () => {
    const error = new Error("boom");
    const failedState = {
      hasError: true,
      error,
      resetKey: "runs",
    };

    expect(ErrorBoundary.getDerivedStateFromProps({ children: null, resetKey: "tasks" }, failedState)).toEqual({
      hasError: false,
      error: null,
      resetKey: "tasks",
    });
  });
});
