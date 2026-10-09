import { describe, expect, test } from "vitest";
import { depthOf, fromIso, isoFrame, isoPixelSize, pickAt, toIso } from "../../src/renderer/src/pages/office/iso";
import { blockDrawable, sceneDrawables } from "../../src/renderer/src/pages/office/scene-renderer";
import { buildFloorPlan } from "../../src/renderer/src/pages/office/floor-plan";

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
    // Off the support, or straddling two of its pieces, a resting block has no single surface to sort after: refused.
    expect(() => blockDrawable(frame, { x: 10, y: 10, w: 4, h: 4 }, 4, colors, 16, counter)).toThrow("A resting block must touch exactly one piece of its support.");
    expect(() => blockDrawable(frame, { x: 744, y: 44, w: 14, h: 14 }, 12, colors, 16, counter)).toThrow("A resting block must touch exactly one piece of its support.");
    // Overhanging the support's outer edge, like a plant's leaves past its pot, still sorts after that one piece.
    const overhang = blockDrawable(frame, { x: 726, y: 64, w: 14, h: 14 }, 12, colors, 16, counter);
    expect(overhang.depth).toBeGreaterThan(underneath.depth);
    // A person standing in front of the counter still draws over what rests on it.
    expect(depthOf({ x: 704, y: 92 })).toBeGreaterThan(resting.depth);
  });
});

test("every piece of the scene sorts by a footprint no longer than 32 on either side, so a person beside a long block is never painted over", () => {
  const plan = buildFloorPlan(12);
  const items = sceneDrawables(isoFrame(plan.world), plan, "winter", new Map(), 0);
  const oversized = items.filter((item) => item.foot.w > 32 || item.foot.h > 32).map((item) => item.foot);
  expect(oversized).toEqual([]);
  // A person at the left basin sorts after both the counter piece and the basin in front of them.
  const atBasin = depthOf({ x: 944, y: 72 });
  for (const foot of [{ x: 928, y: 32 }, { x: 930, y: 40 }]) {
    const item = items.find((candidate) => candidate.foot.x === foot.x && candidate.foot.y === foot.y)!;
    expect(atBasin).toBeGreaterThan(item.depth);
  }
});
