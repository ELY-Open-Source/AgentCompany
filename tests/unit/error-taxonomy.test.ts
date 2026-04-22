import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log/main.js", () => ({
  default: {
    warn: vi.fn(),
  },
}));

import log from "electron-log/main.js";
import { classifyUnknownError } from "../../src/main/errors/taxonomy";

const warn = vi.mocked(log.warn);

describe("error taxonomy", () => {
  beforeEach(() => {
    warn.mockClear();
  });

  it("warns once when raw thrown values cannot be JSON stringified", () => {
    const raw: { self?: unknown } = {};
    raw.self = raw;

    const first = classifyUnknownError(raw, {
      kind: "recoverable",
      code: "test.raw.cyclic",
      message: "Cyclic raw value.",
    });
    const second = classifyUnknownError(raw, {
      kind: "recoverable",
      code: "test.raw.cyclic",
      message: "Cyclic raw value.",
    });

    expect(first.context?.raw).toBe("[object Object]");
    expect(second.context?.raw).toBe("[object Object]");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[errors] stringifyRaw failed; using String(value) for raw thrown value.",
      expect.stringContaining("circular"),
    );
  });
});
