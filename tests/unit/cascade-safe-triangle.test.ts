import { describe, expect, test } from "vitest";
import { pointInTriangle } from "../../src/renderer/src/shared/CascadeMenu";

// The safe triangle: apex at the cursor's prior position, base on the open
// submenu's near (left) edge. A submenu sitting to the right spanning y∈[-20,40]
// at x=100, with the cursor having just been at the origin.
const apex = { x: 0, y: 0 };
const top = { x: 100, y: -20 };
const bottom = { x: 100, y: 40 };

describe("safe triangle (cursor → submenu)", () => {
  test("a cursor sweeping diagonally toward the submenu stays inside", () => {
    // Midway to the submenu, within the widening cone — switching is deferred.
    expect(pointInTriangle({ x: 50, y: 5 }, apex, top, bottom)).toBe(true);
    expect(pointInTriangle({ x: 90, y: 30 }, apex, top, bottom)).toBe(true);
  });

  test("a cursor that drifts off-course toward a sibling row falls outside", () => {
    // At x=50 the cone only spans y∈[-10,20]; y=30 is below it — let the sibling win.
    expect(pointInTriangle({ x: 50, y: 30 }, apex, top, bottom)).toBe(false);
    // Straight down from the apex, away from the submenu entirely.
    expect(pointInTriangle({ x: 5, y: 35 }, apex, top, bottom)).toBe(false);
  });

  test("the apex and the submenu corners are on the triangle", () => {
    expect(pointInTriangle(apex, apex, top, bottom)).toBe(true);
    expect(pointInTriangle(top, apex, top, bottom)).toBe(true);
    expect(pointInTriangle(bottom, apex, top, bottom)).toBe(true);
  });
});
