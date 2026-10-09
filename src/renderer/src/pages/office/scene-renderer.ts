import type { FloorPlan, Rect, RoomSpec } from "./office-types";
import { WALL } from "./floor-plan";
import { drawWindowSky, type SkyScene } from "./sky";
import { BACK_WALL_H, depthOf, drawBox, setGroundTransform, setNorthWallTransform, type BoxColors, type IsoFrame } from "./iso";
import type { Season } from "../../shared/palette-clock";

/** One thing in the scene that people can stand in front of or behind; drawn in depth order with them. */
export interface Drawable {
  depth: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

/** Interior walls are cut away to this height so rooms stay visible. */
const INNER_WALL_H = 14;
/** Longest stretch of a block that sorts as one piece. */
const PIECE = 32;

const PALETTE = {
  wood: "#b08a62",
  woodSeam: "#9c7852",
  corridor: "#a8815c",
  wall: "#6b5f52",
  wallTop: "#4c4239",
  baseboard: "#4f463c",
  ceoCarpet: "#5c6a94",
  ceoCarpetEdge: "#505d85",
  meetingCarpet: "#6c8f78",
  meetingCarpetEdge: "#5e8069",
  snackTileA: "#d8c6a6",
  snackTileB: "#cbb891",
  restTileA: "#adbfd2",
  restTileB: "#9db0c5",
  desk: "#8a6d4c",
  deskExec: "#6a5238",
  monitor: "#4b5058",
  screenOff: "#20242c",
  screenOn: "#37d38a",
  chair: "#3d4148",
  frame: "#3f3831",
} as const;

const LEAVES: Record<Season, { leaf: string; light: string }> = {
  spring: { leaf: "#5f9a52", light: "#e9a3c2" },
  summer: { leaf: "#3f7f3a", light: "#6fb25c" },
  autumn: { leaf: "#b5652a", light: "#e0a23a" },
  winter: { leaf: "#5a7466", light: "#e8eef2" },
};

/** Top, south and east faces of a block from one base colour: lit from above, the east side darkest. */
export function faces(hex: string): BoxColors {
  return { top: hex, south: shade(hex, 0.82), east: shade(hex, 0.66) };
}

/** Floor, rugs and tiles, flat on the ground plane. */
export function drawGround(ctx: CanvasRenderingContext2D, frame: IsoFrame, plan: FloorPlan): void {
  ctx.save();
  setGroundTransform(ctx, frame);
  const { w, h } = plan.world;
  ctx.fillStyle = PALETTE.wood;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PALETTE.woodSeam;
  for (let y = 0; y < h; y += 16) {
    ctx.fillRect(0, y, w, 1);
    for (let x = (y / 16) % 2 === 0 ? 0 : 48; x < w; x += 96) ctx.fillRect(x, y, 1, 16);
  }
  ctx.fillStyle = PALETTE.corridor;
  ctx.fillRect(WALL, 288, w - 2 * WALL, 64);
  for (const room of plan.rooms) drawRoomFloor(ctx, room);
  ctx.restore();
}

function drawRoomFloor(ctx: CanvasRenderingContext2D, room: RoomSpec): void {
  const b = room.bounds;
  if (room.kind === "ceo" || room.kind === "meeting") {
    ctx.fillStyle = room.kind === "ceo" ? PALETTE.ceoCarpet : PALETTE.meetingCarpet;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = room.kind === "ceo" ? PALETTE.ceoCarpetEdge : PALETTE.meetingCarpetEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
    return;
  }
  const [tileA, tileB] = room.kind === "snack" ? [PALETTE.snackTileA, PALETTE.snackTileB] : [PALETTE.restTileA, PALETTE.restTileB];
  for (let ty = 0; ty < b.h; ty += 16) {
    for (let tx = 0; tx < b.w; tx += 16) {
      ctx.fillStyle = ((tx + ty) / 16) % 2 === 0 ? tileA : tileB;
      ctx.fillRect(b.x + tx, b.y + ty, Math.min(16, b.w - tx), Math.min(16, b.h - ty));
    }
  }
}

/** The tall north and west walls, which everything stands in front of, with windows and wall art on the north face. */
export function drawBackWalls(ctx: CanvasRenderingContext2D, frame: IsoFrame, plan: FloorPlan, sky: SkyScene): void {
  const { w, h } = plan.world;
  const wall = faces(PALETTE.wall);
  drawBox(ctx, frame, { x: 0, y: WALL, w: WALL, h: 280 }, 0, BACK_WALL_H, wall);
  drawBox(ctx, frame, { x: 0, y: 344, w: WALL, h: h - 344 - WALL }, 0, BACK_WALL_H, wall);
  drawBox(ctx, frame, { x: 0, y: 0, w, h: WALL }, 0, BACK_WALL_H, { ...wall, top: PALETTE.wallTop });
  ctx.save();
  setNorthWallTransform(ctx, frame, WALL);
  ctx.fillStyle = PALETTE.baseboard;
  ctx.fillRect(0, BACK_WALL_H - 3, w, 3);
  for (const room of plan.rooms) {
    windowRects(room).forEach((rect, index) => {
      ctx.fillStyle = PALETTE.frame;
      ctx.fillRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
      drawWindowSky(ctx, rect, sky, Math.round(room.bounds.x) + index * 53);
      ctx.fillStyle = PALETTE.frame;
      ctx.fillRect(rect.x + rect.w / 2 - 1, rect.y, 2, rect.h);
    });
  }
  drawWallArt(ctx);
  ctx.restore();
}

/** Window glass on each room's stretch of the north wall face: x along the wall, y down from its top. */
export function windowRects(room: RoomSpec): Rect[] {
  const b = room.bounds;
  if (room.kind === "restroom") return [{ x: b.x + b.w - 190, y: 12, w: 44, h: 18 }];
  if (room.kind === "snack") return [{ x: b.x + 104, y: 8, w: 72, h: 24 }];
  return [{ x: b.x + 28, y: 8, w: 72, h: 24 }, { x: b.x + b.w - 100, y: 8, w: 72, h: 24 }];
}

function drawWallArt(ctx: CanvasRenderingContext2D): void {
  // CEO office wall screen and meeting-room whiteboard, between their windows.
  ctx.fillStyle = PALETTE.frame;
  ctx.fillRect(143, 8, 34, 22);
  ctx.fillStyle = "#7f96b8";
  ctx.fillRect(145, 10, 30, 18);
  ctx.fillStyle = "#f2efe8";
  ctx.fillRect(424, 6, 96, 28);
  ctx.fillStyle = "#b3543f";
  ctx.fillRect(432, 12, 26, 3);
  ctx.fillStyle = "#4f7fae";
  ctx.fillRect(432, 19, 40, 3);
  ctx.fillStyle = "#6d9c6b";
  ctx.fillRect(432, 26, 33, 3);
}

/** A block sorted by its footprint centre; one resting on `support` sorts just after every piece of it underneath, so no part of that surface paints over it. */
export function blockDrawable(frame: IsoFrame, foot: Rect, height: number, colors: BoxColors, z = 0, support?: Rect): Drawable {
  const centerDepth = (rect: Rect) => depthOf({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
  if (!support) return { depth: centerDepth(foot), draw: (ctx) => drawBox(ctx, frame, foot, z, height, colors) };
  const under = split(support).filter((piece) => overlaps(piece, foot));
  if (under.length === 0) throw new Error("A resting block must sit over its support.");
  return {
    depth: Math.max(...under.map(centerDepth)) + 0.25,
    draw: (ctx) => drawBox(ctx, frame, foot, z, height, colors),
  };
}

/** Interior walls, furniture and desks as blocks, each sorted by depth against the people; `lit` desks have their screen on. */
export function sceneDrawables(frame: IsoFrame, plan: FloorPlan, season: Season, lit: Set<Rect>): Drawable[] {
  const items: Drawable[] = [];
  // Long blocks go in pieces so each sorts against nearby people on its own.
  const block = (foot: Rect, height: number, colors: BoxColors, z = 0, support?: Rect) => {
    for (const piece of support ? [foot] : split(foot)) items.push(blockDrawable(frame, piece, height, colors, z, support));
  };
  for (const wall of innerWalls(plan)) block(wall, INNER_WALL_H, faces(PALETTE.wall));
  const leaves = LEAVES[season];
  const plant = (cx: number, cy: number) => {
    const pot = { x: cx - 6, y: cy - 6, w: 12, h: 12 };
    block(pot, 8, faces("#8a5a3b"));
    block({ x: cx - 8, y: cy - 8, w: 16, h: 16 }, 12, faces(leaves.leaf), 8, pot);
    block({ x: cx - 4, y: cy - 4, w: 8, h: 8 }, 6, faces(leaves.light), 20, pot);
  };
  // CEO office: rug, executive desk, sofa, plant.
  block({ x: 32, y: 96, w: 24, h: 72 }, 10, faces("#7a4a41"));
  plant(280, 40);
  deskBlocks(plan.ceoDesk, true, lit.has(plan.ceoDesk)).forEach((item) => items.push(item(frame)));
  // Meeting room: table and chairs.
  block({ x: 392, y: 120, w: 160, h: 64 }, 12, faces("#75593b"));
  for (let i = 0; i < 3; i++) {
    block({ x: 414 + i * 52, y: 100, w: 14, h: 12 }, 8, faces(PALETTE.chair));
    block({ x: 414 + i * 52, y: 192, w: 14, h: 12 }, 8, faces(PALETTE.chair));
  }
  // Snack bar: counter, fridge, coffee machine, table and stools.
  const counter = { x: 656, y: 40, w: 224, h: 28 };
  block(counter, 16, faces("#8f8578"));
  block({ x: 700, y: 20, w: 24, h: 20 }, 22, faces("#d5dade"));
  block({ x: 744, y: 44, w: 14, h: 14 }, 12, faces("#2e3238"), 16, counter);
  block({ x: 806, y: 46, w: 12, h: 10 }, 8, faces("#c9a86a"), 16, counter);
  block({ x: 826, y: 46, w: 12, h: 10 }, 10, faces("#b3543f"), 16, counter);
  block({ x: 748, y: 170, w: 40, h: 40 }, 12, faces("#94897b"));
  block({ x: 728, y: 182, w: 12, h: 12 }, 7, faces("#6d5334"));
  block({ x: 796, y: 182, w: 12, h: 12 }, 7, faces("#6d5334"));
  // Restroom: three stalls and a sink counter.
  for (let i = 0; i < 3; i++) block({ x: 1064 + i * 40, y: WALL, w: 38, h: 72 }, 30, faces("#7d8a99"));
  block({ x: 928, y: 32, w: 96, h: 32 }, 14, faces("#c6d2de"));
  for (const [cx, cy] of [[312, 300], [632, 300], [904, 300]] as const) plant(cx, cy);
  for (const desk of plan.desks) deskBlocks(desk.bounds, false, lit.has(desk.bounds)).forEach((item) => items.push(item(frame)));
  return items;
}

/** A desk, its monitor and its chair, each a separate block so a seated person sorts between them. */
function deskBlocks(desk: Rect, executive: boolean, screenOn: boolean): Array<(frame: IsoFrame) => Drawable> {
  const monitor = deskMonitor(desk);
  return [
    ...split(desk).map((piece) => (frame: IsoFrame) => blockDrawable(frame, piece, 14, faces(executive ? PALETTE.deskExec : PALETTE.desk))),
    (frame) => blockDrawable(frame, monitor, 12, { top: PALETTE.monitor, south: screenOn ? PALETTE.screenOn : PALETTE.screenOff, east: shade(PALETTE.monitor, 0.7) }, 14, desk),
    (frame) => blockDrawable(frame, { x: desk.x + desk.w / 2 - 8, y: desk.y + desk.h + 6, w: 16, h: 12 }, 9, faces(PALETTE.chair)),
  ];
}

/** Footprint of a desk's monitor, at the back of the desktop with its screen facing south. */
export function deskMonitor(desk: Rect): Rect {
  return { x: desk.x + desk.w / 2 - 14, y: desk.y + 4, w: 28, h: 6 };
}

/** Partitions, room fronts (with door gaps) and the low outer east and south walls. */
function innerWalls(plan: FloorPlan): Rect[] {
  const { w, h } = plan.world;
  const walls: Rect[] = [
    { x: 304, y: WALL, w: WALL, h: 272 },
    { x: 624, y: WALL, w: WALL, h: 272 },
    { x: 896, y: WALL, w: WALL, h: 272 },
    { x: w - WALL, y: WALL, w: WALL, h: h - 2 * WALL },
    { x: 0, y: h - WALL, w, h: WALL },
  ];
  for (const room of plan.rooms) {
    const b = room.bounds;
    const y = b.y + b.h;
    walls.push({ x: b.x - WALL, y, w: room.doorCx - 24 - b.x + WALL, h: WALL });
    walls.push({ x: room.doorCx + 24, y, w: b.x + b.w - room.doorCx - 24 + WALL, h: WALL });
  }
  return walls;
}

function split(wall: Rect): Rect[] {
  const horizontal = wall.w >= wall.h;
  const length = horizontal ? wall.w : wall.h;
  const pieces: Rect[] = [];
  for (let start = 0; start < length; start += PIECE) {
    const size = Math.min(PIECE, length - start);
    pieces.push(horizontal ? { x: wall.x + start, y: wall.y, w: size, h: wall.h } : { x: wall.x, y: wall.y + start, w: wall.w, h: size });
  }
  return pieces;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function shade(hex: string, factor: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 0xff) * factor);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
