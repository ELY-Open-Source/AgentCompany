import { expect, test } from "vitest";
import { dayPart, resolveTheme, season } from "../../src/renderer/src/shared/palette-clock";

const at = (month: number, hour: number, minute = 0) => new Date(2026, month - 1, 15, hour, minute);

test("the day turns dawn, day, dusk and night at fixed local hours", () => {
  expect(dayPart(at(6, 4, 59))).toBe("night");
  expect(dayPart(at(6, 5))).toBe("dawn");
  expect(dayPart(at(6, 7, 59))).toBe("dawn");
  expect(dayPart(at(6, 8))).toBe("day");
  expect(dayPart(at(6, 16, 59))).toBe("day");
  expect(dayPart(at(6, 17))).toBe("dusk");
  expect(dayPart(at(6, 19, 59))).toBe("dusk");
  expect(dayPart(at(6, 20))).toBe("night");
  expect(dayPart(at(6, 0))).toBe("night");
});

test("seasons follow the months", () => {
  expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => season(at(month, 12)))).toEqual([
    "winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter",
  ]);
});

test("light and dark are kept as chosen; system follows the OS; the clock goes dark only at night", () => {
  expect(resolveTheme("light", true, at(1, 23))).toBe("light");
  expect(resolveTheme("dark", false, at(1, 12))).toBe("dark");
  expect(resolveTheme("system", true, at(1, 12))).toBe("dark");
  expect(resolveTheme("system", false, at(1, 23))).toBe("light");
  expect(resolveTheme("clock", true, at(1, 12))).toBe("light");
  expect(resolveTheme("clock", false, at(1, 18))).toBe("light");
  expect(resolveTheme("clock", false, at(1, 21))).toBe("dark");
  expect(resolveTheme("clock", true, at(1, 4))).toBe("dark");
});
