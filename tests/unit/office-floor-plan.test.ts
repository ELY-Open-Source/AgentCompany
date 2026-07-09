import { describe, expect, test } from "vitest";
import { buildFloorPlan, findPath } from "../../src/renderer/src/pages/office/floor-plan";
import type { FloorPlan, Rect, Vec } from "../../src/renderer/src/pages/office/office-types";

function segmentIntersectsRect(a: Vec, b: Vec, rect: Rect): boolean {
  if (a.x === b.x) {
    const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    return a.x > rect.x && a.x < rect.x + rect.w && y2 > rect.y && y1 < rect.y + rect.h;
  }
  const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  return a.y > rect.y && a.y < rect.y + rect.h && x2 > rect.x && x1 < rect.x + rect.w;
}

function expectWalkablePath(plan: FloorPlan, path: Vec[]): void {
  expect(path.length).toBeGreaterThanOrEqual(2);
  for (let i = 0; i + 1 < path.length; i++) {
    const from = path[i];
    const to = path[i + 1];
    expect(from.x === to.x || from.y === to.y).toBe(true);
    for (const collider of plan.colliders) {
      expect(segmentIntersectsRect(from, to, collider)).toBe(false);
    }
  }
}

describe("office floor plan", () => {
  test("provides the four rooms of a real office", () => {
    const plan = buildFloorPlan(5);
    expect(plan.rooms.map((room) => room.kind)).toEqual(["ceo", "meeting", "snack", "restroom"]);
    expect(plan.amenities.filter((a) => a.kind === "restroom").length).toBeGreaterThanOrEqual(2);
    expect(plan.amenities.some((a) => a.kind === "coffee")).toBe(true);
    expect(plan.amenities.some((a) => a.kind === "snack")).toBe(true);
    // Meetings need at least two attendees, so the table has spots for them.
    expect(plan.amenities.filter((a) => a.kind === "meeting").length).toBeGreaterThanOrEqual(2);
  });

  test("desk field grows by rows so no head-count is ever cut off", () => {
    const small = buildFloorPlan(3);
    const large = buildFloorPlan(63);
    expect(small.desks.length).toBeGreaterThanOrEqual(3);
    expect(large.desks.length).toBeGreaterThanOrEqual(63);
    expect(large.world.h).toBeGreaterThan(small.world.h);
    expect(large.world.w).toBe(small.world.w);
  });

  test("desk seats and amenity stands never sit inside a collider", () => {
    const plan = buildFloorPlan(28);
    const standing = (p: Vec): Rect => ({ x: p.x - 7, y: p.y - 7, w: 14, h: 14 });
    const spots = [plan.ceoSeat, ...plan.desks.map((d) => d.seat), ...plan.amenities.map((a) => a.stand)];
    for (const spot of spots) {
      const body = standing(spot);
      for (const collider of plan.colliders) {
        const overlap =
          body.x < collider.x + collider.w &&
          body.x + body.w > collider.x &&
          body.y < collider.y + collider.h &&
          body.y + body.h > collider.y;
        expect(overlap).toBe(false);
      }
    }
  });

  test("every desk, the CEO seat, and every amenity is reachable from the entrance", () => {
    const plan = buildFloorPlan(17);
    const targets = [plan.ceoSeat, ...plan.desks.map((d) => d.seat), ...plan.amenities.map((a) => a.stand)];
    for (const target of targets) {
      expectWalkablePath(plan, findPath(plan, plan.entrance, target));
    }
  });

  test("routes between desks and amenities across the whole office", () => {
    const plan = buildFloorPlan(20);
    const lastDesk = plan.desks[plan.desks.length - 1];
    const coffee = plan.amenities.find((a) => a.kind === "coffee")!;
    const restroom = plan.amenities.find((a) => a.kind === "restroom")!;
    expectWalkablePath(plan, findPath(plan, lastDesk.seat, coffee.stand));
    expectWalkablePath(plan, findPath(plan, coffee.stand, restroom.stand));
    expectWalkablePath(plan, findPath(plan, restroom.stand, plan.ceoSeat));
  });

  test("re-routes from an arbitrary mid-walk position", () => {
    const plan = buildFloorPlan(10);
    const midCorridor = { x: 500, y: 320 };
    const firstDesk = plan.desks[0];
    expectWalkablePath(plan, findPath(plan, midCorridor, firstDesk.seat));
  });
});
