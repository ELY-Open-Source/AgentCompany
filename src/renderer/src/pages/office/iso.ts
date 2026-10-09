import type { Rect, Vec } from "./office-types";

// 2:1 isometric projection of the plan; the simulation stays in plan units, depth grows with x + y.
const K = 0.5;
/** Head room above the plan's north edge for the back wall and signs. */
export const SKY_MARGIN = 64;
/** Height of the back (north and west) walls, in iso pixels. */
export const BACK_WALL_H = 48;

export interface IsoFrame {
  originX: number;
  size: { w: number; h: number };
}

export function isoFrame(world: { w: number; h: number }): IsoFrame {
  return { originX: world.h * K, size: { w: (world.w + world.h) * K, h: ((world.w + world.h) * K) / 2 + SKY_MARGIN } };
}

export function toIso(frame: IsoFrame, p: Vec, z = 0): Vec {
  return { x: frame.originX + (p.x - p.y) * K, y: SKY_MARGIN + ((p.x + p.y) * K) / 2 - z };
}

/** The ground-plane point under an iso pixel. */
export function fromIso(frame: IsoFrame, s: Vec): Vec {
  const difference = (s.x - frame.originX) / K;
  const sum = ((s.y - SKY_MARGIN) * 2) / K;
  return { x: (sum + difference) / 2, y: (sum - difference) / 2 };
}

export function depthOf(p: Vec): number {
  return p.x + p.y;
}

/** Draws plan-space art (rects in plan units) flat onto the iso ground. */
export function setGroundTransform(ctx: CanvasRenderingContext2D, frame: IsoFrame): void {
  ctx.transform(K, K / 2, -K, K / 2, frame.originX, SKY_MARGIN);
}

/** Draws face-space art onto the south face of the back wall at plan y = `wallY`: x runs along the wall, y down from its top. */
export function setNorthWallTransform(ctx: CanvasRenderingContext2D, frame: IsoFrame, wallY: number): void {
  ctx.transform(K, K / 2, 0, 1, frame.originX - wallY * K, SKY_MARGIN + (wallY * K) / 2 - BACK_WALL_H);
}

/** Draws face-space art onto the east face of the back wall at plan x = `wallX`: x runs south along the wall, y down from its top. */
export function setWestWallTransform(ctx: CanvasRenderingContext2D, frame: IsoFrame, wallX: number): void {
  ctx.transform(-K, K / 2, 0, 1, frame.originX + wallX * K, SKY_MARGIN + (wallX * K) / 2 - BACK_WALL_H);
}

export interface BoxColors {
  top: string;
  south: string;
  east: string;
}

/** An extruded block over a plan footprint, from `z` up `height` iso pixels; its top and two camera-facing sides. */
export function drawBox(ctx: CanvasRenderingContext2D, frame: IsoFrame, foot: Rect, z: number, height: number, colors: BoxColors): void {
  const x0 = foot.x;
  const y0 = foot.y;
  const x1 = foot.x + foot.w;
  const y1 = foot.y + foot.h;
  const top = z + height;
  polygon(ctx, colors.south, [toIso(frame, { x: x0, y: y1 }, z), toIso(frame, { x: x1, y: y1 }, z), toIso(frame, { x: x1, y: y1 }, top), toIso(frame, { x: x0, y: y1 }, top)]);
  polygon(ctx, colors.east, [toIso(frame, { x: x1, y: y1 }, z), toIso(frame, { x: x1, y: y0 }, z), toIso(frame, { x: x1, y: y0 }, top), toIso(frame, { x: x1, y: y1 }, top)]);
  polygon(ctx, colors.top, [toIso(frame, { x: x0, y: y0 }, top), toIso(frame, { x: x1, y: y0 }, top), toIso(frame, { x: x1, y: y1 }, top), toIso(frame, { x: x0, y: y1 }, top)]);
}

function polygon(ctx: CanvasRenderingContext2D, color: string, points: Vec[]): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(Math.round(points[0]!.x), Math.round(points[0]!.y));
  for (const point of points.slice(1)) ctx.lineTo(Math.round(point.x), Math.round(point.y));
  ctx.closePath();
  ctx.fill();
}

/** Sprite box around a person's feet in iso pixels, matching how sprites are drawn. */
const SPRITE = { halfW: 10, above: 40, below: 4 };

/** The person whose drawn sprite covers an iso point, frontmost first; at equal depth the later one, as it is drawn on top. */
export function pickAt<T extends Vec>(frame: IsoFrame, people: T[], point: Vec): T | null {
  let hit: T | null = null;
  for (const person of people) {
    const feet = toIso(frame, person);
    const inside = Math.abs(point.x - feet.x) <= SPRITE.halfW && point.y >= feet.y - SPRITE.above && point.y <= feet.y + SPRITE.below;
    if (inside && (hit === null || depthOf(person) >= depthOf(hit))) hit = person;
  }
  return hit;
}

/** Screen size of one iso pixel in CSS px: two CSS px rounded to whole device pixels. */
export function isoPixelSize(devicePixelRatio: number): number {
  return Math.max(1, Math.round(2 * devicePixelRatio)) / devicePixelRatio;
}
