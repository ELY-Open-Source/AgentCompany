import { expect, test } from "vitest";
import { PIXEL_ICONS } from "../../src/renderer/src/shared/pixel-icons";

test("every icon is a 12x12 bitmap of lit and dark pixels, and no two icons are the same", () => {
  for (const [name, bitmap] of Object.entries(PIXEL_ICONS)) {
    const rows = bitmap.split(" ");
    expect(rows, name).toHaveLength(12);
    for (const row of rows) expect(row, name).toMatch(/^[#.]{12}$/);
    expect(bitmap.includes("#"), name).toBe(true);
  }
  const bitmaps = Object.values(PIXEL_ICONS);
  expect(new Set(bitmaps).size).toBe(bitmaps.length);
});
