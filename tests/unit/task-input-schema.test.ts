import { describe, expect, it } from "vitest";

import { taskInputSchema } from "../../src/shared/contracts";

describe("taskInputSchema", () => {
  const baseTask = {
    companyId: "00000000-0000-4000-8000-000000000001",
    title: "Prepare launch review",
  };

  it("normalizes omitted requiresFilesystem to false", () => {
    const parsed = taskInputSchema.parse(baseTask);
    expect(parsed.requiresFilesystem).toBe(false);
  });

  it("preserves explicit requiresFilesystem intent", () => {
    const parsed = taskInputSchema.parse({
      ...baseTask,
      requiresFilesystem: true,
    });
    expect(parsed.requiresFilesystem).toBe(true);
  });
});
