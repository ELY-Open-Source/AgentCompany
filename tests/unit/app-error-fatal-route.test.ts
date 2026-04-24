import { afterEach, describe, expect, it, vi } from "vitest";
import { logAppError, setFatalErrorRouteForTesting } from "../../src/main/errors";
import type { AppError } from "../../src/main/errors";

describe("AppError fatal route", () => {
  afterEach(() => {
    setFatalErrorRouteForTesting(null);
  });

  it("routes fatal errors through the process-level handler", () => {
    const logger = { error: vi.fn(), warn: vi.fn() };
    const routed: AppError[] = [];
    const sentinel = new Error("fatal route called");
    setFatalErrorRouteForTesting((error) => {
      routed.push(error);
      throw sentinel;
    });

    expect(() => logAppError(logger, new Error("sqlite corrupt"), {
      kind: "fatal",
      code: "db.sqlite.corrupt",
      message: "SQLite profile is corrupt",
      context: { profile: "test" },
    })).toThrow(sentinel);

    expect(routed[0]?.kind).toBe("fatal");
    expect(routed[0]?.code).toBe("db.sqlite.corrupt");
    expect(logger.error).toHaveBeenCalled();
  });
});
