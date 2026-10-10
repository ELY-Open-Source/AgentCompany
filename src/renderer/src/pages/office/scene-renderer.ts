import type { OfficeState } from "./agent-state";
import type { FloorPlan, Rect, RoomSpec } from "./office-types";
import { WALL } from "./floor-plan";
import { drawWeather, drawWindowSky, type SkyScene, type Weather } from "./sky";
import { BACK_WALL_H, depthOf, drawBox, setGroundTransform, setSouthFaceTransform, type BoxColors, type IsoFrame } from "./iso";
import { drawBasin, drawCoffeeMachine, drawMonitorScreen, drawToilet, drawWallClock } from "./props";
import type { Season } from "../../shared/palette-clock";

/** One thing in the scene that people can stand in front of or behind; drawn in depth order with them. */
export interface Drawable {
  depth: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

/** A piece of the scene and the plan footprint it sorts by; grounded pieces cast a contact shadow. */
export interface SceneDrawable extends Drawable {
  foot: Rect;
  grounded: boolean;
}

/** Interior walls are cut away to this height so rooms stay visible. */
const INNER_WALL_H = 14;
/** Longest side of a block that sorts as one piece. */
const PIECE = 32;

const PALETTE = {
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
  chair: "#3d4148",
  frame: "#3f3831",
  panelSeam: "#5d5246",
} as const;

const PLANKS = ["#b08a62", "#b8936a", "#a9845c", "#b48e65"];

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
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  for (let y = 0; y < h; y += 16) {
    for (let x = (y / 16) % 2 === 0 ? -48 : 0; x < w; x += 96) {
      const grain = (Math.imul(x + 977, 31) ^ Math.imul(y + 131, 17)) >>> 0;
      ctx.fillStyle = PLANKS[grain % PLANKS.length]!;
      ctx.fillRect(x, y, 96, 16);
      ctx.fillStyle = PALETTE.woodSeam;
      ctx.fillRect(x + 8 + (grain % 40), y + 4 + (grain % 3) * 3, 22 + (grain % 17), 1);
      ctx.fillRect(x + 50 + (grain % 23), y + 10 - (grain % 2) * 4, 14, 1);
      ctx.fillRect(x, y, 1, 16);
    }
    ctx.fillStyle = PALETTE.woodSeam;
    ctx.fillRect(0, y, w, 1);
  }
  ctx.fillStyle = PALETTE.corridor;
  ctx.fillRect(WALL, 288, w - 2 * WALL, 64);
  ctx.fillStyle = "#93704f";
  ctx.fillRect(WALL, 292, w - 2 * WALL, 1);
  ctx.fillRect(WALL, 347, w - 2 * WALL, 1);
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
    ctx.fillStyle = room.kind === "ceo" ? "#66749e" : "#769a82";
    for (let ty = b.y + 16; ty < b.y + b.h - 12; ty += 12) {
      for (let tx = b.x + 16 + (((ty - b.y) / 12) % 2) * 6; tx < b.x + b.w - 12; tx += 12) ctx.fillRect(tx, ty, 2, 2);
    }
    return;
  }
  const [tileA, tileB] = room.kind === "snack" ? [PALETTE.snackTileA, PALETTE.snackTileB] : [PALETTE.restTileA, PALETTE.restTileB];
  for (let ty = 0; ty < b.h; ty += 16) {
    for (let tx = 0; tx < b.w; tx += 16) {
      ctx.fillStyle = ((tx + ty) / 16) % 2 === 0 ? tileA : tileB;
      ctx.fillRect(b.x + tx, b.y + ty, Math.min(16, b.w - tx), Math.min(16, b.h - ty));
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  for (let ty = 0; ty < b.h; ty += 16) ctx.fillRect(b.x, b.y + ty, b.w, 1);
  for (let tx = 0; tx < b.w; tx += 16) ctx.fillRect(b.x + tx, b.y, 1, b.h);
}

/** Soft shadows on the floor where furniture and walls meet it, cast toward the south-east. */
export function drawContactShadows(ctx: CanvasRenderingContext2D, frame: IsoFrame, items: SceneDrawable[]): void {
  ctx.save();
  setGroundTransform(ctx, frame);
  ctx.fillStyle = "rgba(28,18,10,0.2)";
  for (const item of items) if (item.grounded) ctx.fillRect(item.foot.x + 1, item.foot.y + 1, item.foot.w + 3, item.foot.h + 3);
  ctx.restore();
}

/** What the back walls show: the sky and weather outside, and the time for the wall clock. */
export interface Outside {
  sky: SkyScene;
  weather: Weather;
  clock: Date;
  timeMs: number;
}

/** The tall north and west walls, which everything stands in front of, with panels, windows, a clock and wall art on the north face. */
export function drawBackWalls(ctx: CanvasRenderingContext2D, frame: IsoFrame, plan: FloorPlan, outside: Outside): void {
  const { w, h } = plan.world;
  const wall = faces(PALETTE.wall);
  drawBox(ctx, frame, { x: 0, y: WALL, w: WALL, h: 280 }, 0, BACK_WALL_H, wall);
  drawBox(ctx, frame, { x: 0, y: 344, w: WALL, h: h - 344 - WALL }, 0, BACK_WALL_H, wall);
  drawBox(ctx, frame, { x: 0, y: 0, w, h: WALL }, 0, BACK_WALL_H, { ...wall, top: PALETTE.wallTop });
  ctx.save();
  setSouthFaceTransform(ctx, frame, WALL, BACK_WALL_H);
  ctx.fillStyle = PALETTE.wallTop;
  ctx.fillRect(0, 0, w, 2);
  ctx.fillStyle = PALETTE.panelSeam;
  for (let x = 32; x < w; x += 32) ctx.fillRect(x, 2, 1, BACK_WALL_H - 5);
  ctx.fillStyle = "#62574b";
  ctx.fillRect(0, BACK_WALL_H - 14, w, 11);
  ctx.fillStyle = "#857766";
  ctx.fillRect(0, BACK_WALL_H - 15, w, 1);
  ctx.fillStyle = PALETTE.baseboard;
  ctx.fillRect(0, BACK_WALL_H - 3, w, 3);
  for (const room of plan.rooms) {
    windowRects(room).forEach((rect, index) => {
      const seed = Math.round(room.bounds.x) + index * 53;
      ctx.fillStyle = PALETTE.frame;
      ctx.fillRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
      drawWindowSky(ctx, rect, outside.sky, seed);
      drawWeather(ctx, rect, outside.weather, outside.timeMs, seed);
      ctx.fillStyle = PALETTE.frame;
      ctx.fillRect(rect.x + rect.w / 2 - 1, rect.y, 2, rect.h);
      ctx.fillStyle = "#9c8f7c";
      ctx.fillRect(rect.x - 3, rect.y + rect.h + 2, rect.w + 6, 1);
      ctx.fillStyle = "#b9a98f";
      ctx.fillRect(rect.x - 7, rect.y - 3, 5, rect.h + 6);
      ctx.fillRect(rect.x + rect.w + 2, rect.y - 3, 5, rect.h + 6);
      ctx.fillStyle = "#a39278";
      ctx.fillRect(rect.x - 5, rect.y - 3, 1, rect.h + 6);
      ctx.fillRect(rect.x + rect.w + 4, rect.y - 3, 1, rect.h + 6);
    });
  }
  drawWallArt(ctx);
  drawWallClock(ctx, 664, 10, outside.clock);
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
  // Restroom mirror over the sinks.
  ctx.fillStyle = PALETTE.frame;
  ctx.fillRect(934, 8, 84, 22);
  ctx.fillStyle = "#b9d3e6";
  ctx.fillRect(936, 10, 80, 18);
  ctx.fillStyle = "#e3f0f8";
  ctx.fillRect(944, 12, 2, 12);
  ctx.fillRect(948, 12, 1, 8);
}

/** A block sorted by its footprint centre; one resting on `support` touches exactly one piece of it (overhanging its outer edge is fine) and sorts just after that piece. */
export function blockDrawable(frame: IsoFrame, foot: Rect, height: number, colors: BoxColors, z = 0, support?: Rect): SceneDrawable {
  return { foot, grounded: z === 0 && !support, depth: support ? restingDepth(foot, support) : centerDepth(foot), draw: (ctx) => drawBox(ctx, frame, foot, z, height, colors) };
}

function restingDepth(foot: Rect, support: Rect): number {
  const under = split(support).filter((piece) => overlaps(piece, foot));
  if (under.length !== 1) throw new Error("A resting block must touch exactly one piece of its support.");
  return centerDepth(under[0]!) + 0.25;
}

function centerDepth(rect: Rect): number {
  return depthOf({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
}

/** Interior walls, furniture and desks as blocks, each sorted by depth against the people; `screens` gives each desk's screen its agent's state, and `timeMs` animates screens and steam. */
export function sceneDrawables(frame: IsoFrame, plan: FloorPlan, season: Season, screens: Map<Rect, OfficeState>, timeMs: number): SceneDrawable[] {
  const items: SceneDrawable[] = [];
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
  deskBlocks(plan.ceoDesk, true, screens.get(plan.ceoDesk) ?? "idle", timeMs).forEach((item) => items.push(item(frame)));
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
  const machine = { x: 726, y: 44, w: 14, h: 14 };
  items.push({ foot: machine, grounded: false, depth: restingDepth(machine, counter), draw: (ctx) => drawCoffeeMachine(ctx, frame, machine, 16, timeMs) });
  block({ x: 792, y: 46, w: 12, h: 10 }, 8, faces("#c9a86a"), 16, counter);
  block({ x: 826, y: 46, w: 12, h: 10 }, 10, faces("#b3543f"), 16, counter);
  block({ x: 748, y: 170, w: 40, h: 40 }, 12, faces("#94897b"));
  block({ x: 728, y: 182, w: 12, h: 12 }, 7, faces("#6d5334"));
  block({ x: 796, y: 182, w: 12, h: 12 }, 7, faces("#6d5334"));
  // Restroom: three open stalls with toilets between partitions, and a sink counter.
  for (let i = 0; i < 3; i++) {
    const cx = 1084 + i * 40;
    const toilet = { x: cx - 6, y: WALL + 2, w: 12, h: 16 };
    items.push({ foot: toilet, grounded: true, depth: centerDepth(toilet), draw: (ctx) => drawToilet(ctx, frame, cx, WALL + 2) });
  }
  for (let i = 0; i <= 3; i++) block({ x: 1063 + i * 40, y: WALL, w: 2, h: 48 }, INNER_WALL_H, faces("#7d8a99"));
  const sinks = { x: 928, y: 32, w: 96, h: 32 };
  block(sinks, 14, { top: "#c6d2de", south: "#a7b4c2", east: "#909eae" });
  for (let i = 0; i < 2; i++) {
    const basin = { x: sinks.x + 2 + i * 64, y: sinks.y + 8, w: 28, h: 16 };
    items.push({ foot: basin, grounded: false, depth: restingDepth(basin, sinks), draw: (ctx) => drawBasin(ctx, frame, basin, 14) });
  }
  for (const [cx, cy] of [[312, 300], [632, 300], [904, 300]] as const) plant(cx, cy);
  for (const desk of plan.desks) deskBlocks(desk.bounds, false, screens.get(desk.bounds) ?? "idle", timeMs).forEach((item) => items.push(item(frame)));
  return items;
}

/** A desk with its monitor, keyboard and clutter, and the office chair in front of it, each a separate block so a seated person sorts between them. */
function deskBlocks(desk: Rect, executive: boolean, screen: OfficeState, timeMs: number): Array<(frame: IsoFrame) => SceneDrawable> {
  const monitor = deskMonitor(desk);
  const middle = desk.x + Math.floor(desk.w / 2 / PIECE) * PIECE;
  const seed = Math.round(desk.x + desk.y);
  const on = (foot: Rect, height: number, colors: BoxColors, z = 14) => (frame: IsoFrame) => blockDrawable(frame, foot, height, colors, z, desk);
  const parts: Array<(frame: IsoFrame) => SceneDrawable> = [
    ...split(desk).map((piece) => (frame: IsoFrame) => blockDrawable(frame, piece, 14, faces(executive ? PALETTE.deskExec : PALETTE.desk))),
    on({ x: monitor.x + 11, y: monitor.y + 1, w: 4, h: 4 }, 2, faces("#3a3e45")),
    (frame) => {
      const shell = blockDrawable(frame, monitor, 12, { top: PALETTE.monitor, south: PALETTE.monitor, east: shade(PALETTE.monitor, 0.7) }, 16, desk);
      return { foot: monitor, grounded: false, depth: shell.depth, draw: (ctx) => {
        shell.draw(ctx);
        drawMonitorScreen(ctx, frame, monitor, 16, 12, screen, timeMs, seed);
      } };
    },
    on({ x: middle + 5, y: desk.y + 16, w: 20, h: 6 }, 1, { top: "#d9dce0", south: "#b8bcc2", east: "#a6abb2" }),
    on({ x: middle + 27, y: desk.y + 18, w: 3, h: 4 }, 1, faces("#cfd3d8")),
    ...chairBlocks(desk.x + desk.w / 2, desk.y + desk.h + 6),
  ];
  if (seed % 2 === 0) parts.push(on({ x: desk.x + 10, y: desk.y + 10, w: 5, h: 5 }, 5, { top: "#6b4a2f", south: "#e8e3d8", east: "#cfc9bc" }));
  if (seed % 3 === 0) parts.push(on({ x: desk.x + desk.w - 14, y: desk.y + 8, w: 10, h: 12 }, 2, faces("#f4f1ea")));
  if (seed % 3 === 1) {
    parts.push(on({ x: desk.x + desk.w - 13, y: desk.y + 6, w: 8, h: 8 }, 4, faces("#c9693f")));
    parts.push(on({ x: desk.x + desk.w - 14, y: desk.y + 5, w: 10, h: 10 }, 6, faces("#4f8a45"), 18));
  }
  if (executive) {
    parts.push(on({ x: desk.x + 8, y: desk.y + 6, w: 6, h: 6 }, 1, faces("#b89448")));
    parts.push(on({ x: desk.x + 10, y: desk.y + 8, w: 2, h: 2 }, 10, faces("#b89448"), 15));
    parts.push(on({ x: desk.x + 7, y: desk.y + 5, w: 8, h: 8 }, 4, faces("#2f5d4a"), 25));
  }
  return parts;
}

/** An office chair: five-star base, gas lift, cushioned seat, and a backrest on the desk side that the sitter covers. */
function chairBlocks(cx: number, y: number): Array<(frame: IsoFrame) => SceneDrawable> {
  return [
    (frame) => blockDrawable(frame, { x: cx - 7, y: y + 1, w: 14, h: 10 }, 2, faces("#2d3036")),
    (frame) => blockDrawable(frame, { x: cx - 1, y: y + 5, w: 2, h: 2 }, 5, faces("#5d6168"), 2),
    (frame) => blockDrawable(frame, { x: cx - 8, y, w: 16, h: 11 }, 3, faces("#4a5060"), 7),
    (frame) => blockDrawable(frame, { x: cx - 8, y, w: 16, h: 3 }, 11, faces(PALETTE.chair), 8),
  ];
}

/** Footprint of a desk's monitor, at the back of the desktop with its screen facing south, inside the desk piece that holds the desk's centre. */
function deskMonitor(desk: Rect): Rect {
  const piece = Math.floor(desk.w / 2 / PIECE) * PIECE;
  return { x: desk.x + piece + 3, y: desk.y + 4, w: 26, h: 6 };
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

function split(block: Rect): Rect[] {
  const pieces: Rect[] = [];
  for (let dy = 0; dy < block.h; dy += PIECE) {
    for (let dx = 0; dx < block.w; dx += PIECE) {
      pieces.push({ x: block.x + dx, y: block.y + dy, w: Math.min(PIECE, block.w - dx), h: Math.min(PIECE, block.h - dy) });
    }
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
