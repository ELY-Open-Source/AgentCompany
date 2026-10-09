import { expect, test } from "vitest";
import { pixelScale } from "../../src/renderer/src/shared/pixel-scale";

test("one font pixel always covers a whole number of screen pixels, never fewer than one", () => {
  expect(pixelScale(1)).toBe(1);
  expect(pixelScale(2)).toBe(1);
  expect(pixelScale(1.5)).toBeCloseTo(4 / 3);
  expect(pixelScale(1.25)).toBeCloseTo(0.8);
  expect(pixelScale(1.75)).toBeCloseTo(8 / 7);
  expect(pixelScale(0.9)).toBeCloseTo(1 / 0.9);
  for (const ratio of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    const device = 12 * pixelScale(ratio) * ratio;
    expect(Math.abs(device - Math.round(device))).toBeLessThan(1e-9);
    expect(Math.round(device) % 12).toBe(0);
  }
});
