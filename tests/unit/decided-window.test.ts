import { describe, expect, test } from "vitest";
import { decidedWindow } from "../../src/renderer/src/pages/approvals/decided-window";

describe("the decided approvals list", () => {
  const decided = Array.from({ length: 30 }, (_, index) => ({ id: `apr_${index}` }));

  test("shows the newest 24", () => {
    expect(decidedWindow(decided, null, 24).map((item) => item.id)).toEqual(decided.slice(0, 24).map((item) => item.id));
  });

  test("adds an older focused approval so a link to it lands on it", () => {
    expect(decidedWindow(decided, "apr_27", 24).map((item) => item.id)).toEqual([...decided.slice(0, 24).map((item) => item.id), "apr_27"]);
    expect(decidedWindow(decided, "apr_3", 24)).toHaveLength(24);
  });

  test("pages further back on request", () => {
    expect(decidedWindow(decided, null, 48).map((item) => item.id)).toEqual(decided.map((item) => item.id));
  });
});
