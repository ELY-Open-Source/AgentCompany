import { describe, expect, test } from "vitest";
import { weatherFor } from "../../src/renderer/src/pages/office/sky";
import { clockHands } from "../../src/renderer/src/pages/office/props";

const day = (month: number, date: number, hour = 12) => new Date(2026, month - 1, date, hour, 0, 0);

describe("office decor", () => {
  test("the view outside keeps one weather all day and fits the season", () => {
    expect(weatherFor(day(1, 10, 8))).toBe(weatherFor(day(1, 10, 22)));
    const seen = (month: number) => new Set(Array.from({ length: 28 }, (_, index) => weatherFor(day(month, index + 1))));
    expect([...seen(1)].sort()).toEqual(["clear", "snow"]);
    expect([...seen(4)].sort()).toEqual(["clear", "rain"]);
    expect(seen(7).has("snow")).toBe(false);
    expect(seen(7).has("leaves")).toBe(false);
    expect(seen(10).has("leaves")).toBe(true);
    expect(seen(10).has("snow")).toBe(false);
  });

  test("the wall clock shows the local time: hands measured clockwise from twelve", () => {
    const at = (hour: number, minute: number) => clockHands(new Date(2026, 0, 1, hour, minute));
    expect(at(0, 0)).toEqual({ hour: 0, minute: 0 });
    expect(at(3, 0).hour).toBeCloseTo(Math.PI / 2);
    expect(at(15, 0).hour).toBeCloseTo(Math.PI / 2);
    expect(at(6, 30).hour).toBeCloseTo((6.5 / 12) * 2 * Math.PI);
    expect(at(6, 30).minute).toBeCloseTo(Math.PI);
    expect(at(9, 45).minute).toBeCloseTo(1.5 * Math.PI);
  });
});
