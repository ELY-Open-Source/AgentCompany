import { describe, expect, test } from "vitest";
import { depthOf, fromIso, isoFrame, isoPixelSize, pickAt, toIso } from "../../src/renderer/src/pages/office/iso";
import { blockDrawable } from "../../src/renderer/src/pages/office/scene-renderer";

const frame = isoFrame({ w: 1216, h: 600 });

describe("office isometric projection", () => {
  test("the plan's corners land on a 2:1 diamond inside the frame", () => {
    const north = toIso(frame, { x: 0, y: 0 });
    const east = toIso(frame, { x: 1216, y: 0 });
    const west = toIso(frame, { x: 0, y: 600 });
    const south = toIso(frame, { x: 1216, y: 600 });
    expect(west.x).toBe(0);
    expect(east.x).toBe(frame.size.w);
    expect(south.y).toBe(frame.size.h);
    expect(north.y).toBeLessThan(east.y);
    expect(north.y).toBeLessThan(west.y);
    // Moving along x goes twice as far across as down: the 2:1 slope.
    expect((east.x - north.x) / (east.y - north.y)).toBe(2);
    expect((north.x - west.x) / (west.y - north.y)).toBe(2);
  });

  test("height lifts a point straight up, and the ground point under any pixel round-trips", () => {
    const point = { x: 432, y: 210 };
    expect(toIso(frame, point, 30)).toEqual({ x: toIso(frame, point).x, y: toIso(frame, point).y - 30 });
    for (const p of [point, { x: 0, y: 0 }, { x: 1216, y: 600 }, { x: 17.5, y: 403.25 }]) {
      const back = fromIso(frame, toIso(frame, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  test("a click on a drawn sprite picks that person, the one in front when sprites overlap", () => {
    const back = { id: "back", x: 500, y: 300 };
    const front = { id: "front", x: 506, y: 306 };
    const feet = toIso(frame, back);
    expect(pickAt(frame, [back], { x: feet.x, y: feet.y - 20 })?.id).toBe("back");
    expect(pickAt(frame, [back], { x: feet.x + 30, y: feet.y - 20 })).toBeNull();
    expect(pickAt(frame, [back], { x: feet.x, y: feet.y - 60 })).toBeNull();
    expect(depthOf(front)).toBeGreaterThan(depthOf(back));
    expect(pickAt(frame, [back, front], { x: feet.x, y: feet.y - 10 })?.id).toBe("front");
    expect(pickAt(frame, [front, back], { x: feet.x, y: feet.y - 10 })?.id).toBe("front");
  });

  test("an iso pixel covers a whole number of device pixels", () => {
    for (const ratio of [1, 1.25, 1.5, 2, 3]) {
      const device = isoPixelSize(ratio) * ratio;
      expect(device).toBe(Math.round(device));
      expect(device).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("office depth order", () => {
  test("people at equal depth: the later one is drawn on top and is the one a click picks", () => {
    const first = { id: "first", x: 500, y: 300 };
    const second = { id: "second", x: 506, y: 294 };
    expect(depthOf(first)).toBe(depthOf(second));
    const feet = toIso(frame, first);
    expect(pickAt(frame, [first, second], { x: feet.x + 3, y: feet.y - 10 })?.id).toBe("second");
  });

  test("something resting on a surface sorts after the surface, even when its own footprint is further back", () => {
    const counter = { x: 656, y: 40, w: 224, h: 28 };
    // A cup at the back corner of the third 32-unit counter piece.
    const cup = { x: 722, y: 41, w: 6, h: 6 };
    const colors = { top: "#000", south: "#000", east: "#000" };
    const underneath = blockDrawable(frame, { x: 720, y: 40, w: 32, h: 28 }, 16, colors);
    const loose = blockDrawable(frame, cup, 12, colors, 16);
    const resting = blockDrawable(frame, cup, 12, colors, 16, counter);
    expect(loose.depth).toBeLessThan(underneath.depth);
    expect(resting.depth).toBeGreaterThan(underneath.depth);
    expect(() => blockDrawable(frame, { x: 10, y: 10, w: 4, h: 4 }, 4, colors, 16, counter)).toThrow("A resting block must sit over its support.");
    // The coffee machine straddles the pieces at 720..752 and 752..784: it sorts after both.
    const machine = blockDrawable(frame, { x: 744, y: 44, w: 14, h: 14 }, 12, colors, 16, counter);
    for (const x of [720, 752]) expect(machine.depth).toBeGreaterThan(blockDrawable(frame, { x, y: 40, w: 32, h: 28 }, 16, colors).depth);
    // A person standing in front of the counter still draws over what rests on it.
    expect(depthOf({ x: 704, y: 92 })).toBeGreaterThan(resting.depth);
  });
});
