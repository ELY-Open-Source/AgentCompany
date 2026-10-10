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

/** Draws face-space art onto a south-facing face at plan y = `planeY` whose top is at height `topZ`: x runs along the face, y down from its top. */
export function setSouthFaceTransform(ctx: CanvasRenderingContext2D, frame: IsoFrame, planeY: number, topZ: number): void {
  ctx.transform(K, K / 2, 0, 1, frame.originX - planeY * K, SKY_MARGIN + (planeY * K) / 2 - topZ);
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
  if (height <= 0) return;
  const rim = toIso(frame, { x: x1, y: y1 }, top);
  polygon(ctx, "rgba(255,255,255,0.2)", [toIso(frame, { x: x0, y: y1 }, top), rim, { x: rim.x, y: rim.y + 0.5 }, toIso(frame, { x: x0, y: y1 }, top - 0.5)]);
  polygon(ctx, "rgba(255,255,255,0.14)", [rim, toIso(frame, { x: x1, y: y0 }, top), toIso(frame, { x: x1, y: y0 }, top - 0.5), { x: rim.x, y: rim.y + 0.5 }]);
  const base = toIso(frame, { x: x1, y: y1 }, z);
  polygon(ctx, "rgba(255,255,255,0.1)", [{ x: rim.x - 0.5, y: rim.y }, rim, base, { x: base.x - 0.5, y: base.y }]);
}

function polygon(ctx: CanvasRenderingContext2D, color: string, points: Vec[]): void {
  const art = Math.max(1, Math.round(ctx.getTransform().a));
  const snap = (value: number) => Math.round(value * art) / art;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(snap(points[0]!.x), snap(points[0]!.y));
  for (const point of points.slice(1)) ctx.lineTo(snap(point.x), snap(point.y));
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

/** Scene pixels per iso pixel: two when an iso pixel spans an even number of device pixels, so detail stays on whole device pixels. */
export function artScale(devicePixelRatio: number): number {
  return Math.max(1, Math.round(2 * devicePixelRatio)) % 2 === 0 ? 2 : 1;
}
