import { describe, expect, test } from "vitest";
import { finishSprite, PixelGrid } from "../../src/renderer/src/pages/office/pixel-grid";
import { personArt, ANCHOR } from "../../src/renderer/src/pages/office/person-art";
import { appearanceFor, frameFor } from "../../src/renderer/src/pages/office/sprites";
import { ditherLevels, sunPatches } from "../../src/renderer/src/pages/office/lighting";

const pixel = (grid: PixelGrid, x: number, y: number) => Array.from(grid.data.subarray((y * grid.w + x) * 4, (y * grid.w + x) * 4 + 4));

describe("office pixel art", () => {
  test("a finished sprite is rim-lit top-left, shaded bottom-right, and outlined in a dark tone of what it borders", () => {
    const grid = new PixelGrid(6, 6);
    grid.rect(1, 1, 4, 4, "#808080");
    finishSprite(grid);
    expect(pixel(grid, 1, 1)).toEqual([146, 146, 146, 255]);
    expect(pixel(grid, 4, 4)).toEqual([108, 108, 108, 255]);
    expect(pixel(grid, 2, 2)).toEqual([128, 128, 128, 255]);
    expect(pixel(grid, 0, 2)).toEqual([41, 41, 41, 255]);
    expect(pixel(grid, 0, 0)[3]).toBe(0);
  });

  test("people stand on the anchor in every facing, and west mirrors east", () => {
    const look = appearanceFor("agent-7", false);
    for (const facing of ["south", "north", "east", "west"] as const) {
      const grid = personArt(look, { facing, step: -1, typing: -1, blink: false, carrying: null }, false);
      const feetRow = Array.from({ length: grid.w }, (_, x) => grid.alpha(x, ANCHOR.y - 1));
      expect(feetRow.some((alpha) => alpha > 0)).toBe(true);
      expect(Array.from({ length: grid.w }, (_, x) => grid.alpha(x, ANCHOR.y + 2)).every((alpha) => alpha === 0)).toBe(true);
    }
    const east = personArt(look, { facing: "east", step: 0, typing: -1, blink: false, carrying: "coffee" }, false);
    const west = personArt(look, { facing: "west", step: 0, typing: -1, blink: false, carrying: "coffee" }, false);
    expect(pixel(west, 3, 40)).toEqual(pixel(east, east.w - 4, 40));
  });

  test("poses: four walk steps, typing beats only while working, a short blink", () => {
    const pose = { facing: "south" as const, walkPhase: 0, working: false, carrying: null, timeMs: 0, animSeed: 3 };
    expect(frameFor(pose).step).toBe(-1);
    expect(new Set([0.1, 1.7, 3.3, 4.9].map((walkPhase) => frameFor({ ...pose, walkPhase }).step))).toEqual(new Set([0, 1, 2, 3]));
    expect(frameFor(pose).typing).toBe(-1);
    expect(new Set([0, 180].map((timeMs) => frameFor({ ...pose, working: true, timeMs }).typing))).toEqual(new Set([0, 1]));
    const blinks = Array.from({ length: 400 }, (_, i) => frameFor({ ...pose, timeMs: i * 25 }).blink).filter(Boolean).length;
    expect(blinks).toBeGreaterThan(0);
    expect(blinks).toBeLessThan(20);
  });
});

describe("office lighting", () => {
  test("the light map bands into whole levels with an ordered dither", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(138);
    ditherLevels(data, 4);
    const levels = new Set(Array.from(data).filter((_, i) => i % 4 !== 3));
    expect(levels.size).toBe(2);
    for (const value of levels) expect(Math.round((value / 255) * 12) / 12).toBeCloseTo(value / 255, 2);
  });

  test("sun falls through the windows by day, slanting with the hour, and not at night", () => {
    const glass = [{ x: 100, y: 8, w: 40, h: 20 }];
    expect(sunPatches(glass, new Date(2026, 9, 9, 23, 0))).toEqual([]);
    const morning = sunPatches(glass, new Date(2026, 9, 9, 9, 0))[0]!;
    const evening = sunPatches(glass, new Date(2026, 9, 9, 17, 0))[0]!;
    expect(morning[2]!.x).toBeGreaterThan(evening[2]!.x);
    expect(morning[2]!.y).toBeGreaterThan(morning[1]!.y);
  });
});
