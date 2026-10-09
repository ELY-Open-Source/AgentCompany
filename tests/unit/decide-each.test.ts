import { describe, expect, test } from "vitest";
import { decideEach } from "../../src/renderer/src/pages/approvals/decide-each";

describe("deciding several requests", () => {
  test("decides one at a time, reports progress, and returns each result", async () => {
    const order: string[] = [];
    const progress: number[] = [];
    const result = await decideEach(
      [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }],
      async (item) => {
        order.push(item.id);
        if (item.id === "b") throw new Error("Approval was already decided.");
      },
      (done) => progress.push(done),
    );
    expect(order).toEqual(["a", "b", "c"]);
    expect(progress).toEqual([1, 2, 3]);
    expect(result).toEqual({ approved: ["a", "c"], failed: [{ id: "b", title: "B", reason: "Approval was already decided." }] });
  });
});
