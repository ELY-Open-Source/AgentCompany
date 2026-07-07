import type { FloorPlan, Rect, RoomSpec } from "./office-types";
import { WALL } from "./floor-plan";

/**
 * Draws the static office world in a 3/4 top-down pixel style: wood floor,
 * room interiors, wall faces with windows, furniture, and door signage.
 * Everything here is a pure function of the floor plan and the visible rect.
 */

/** Height of the visible north-wall face inside each room. */
export const WALL_FACE_H = 48;

const PALETTE = {
  wood: "#b08a62",
  woodSeam: "#9c7852",
  corridor: "#a8815c",
  wallFill: "#4c4239",
  wallEdge: "#3b332c",
  wallFace: "#6b5f52",
  wallFaceShadow: "#5d5246",
  baseboard: "#4f463c",
  ceoCarpet: "#5c6a94",
  ceoCarpetEdge: "#505d85",
  meetingCarpet: "#6c8f78",
  meetingCarpetEdge: "#5e8069",
  snackTileA: "#d8c6a6",
  snackTileB: "#cbb891",
  restTileA: "#adbfd2",
  restTileB: "#9db0c5",
  deskWood: "#8a6d4c",
  deskWoodDark: "#75593b",
  deskLeg: "#5f4832",
  screenOff: "#20242c",
  monitorShell: "#4b5058",
  chair: "#3d4148",
  chairDark: "#33373d",
  glassSky: "#8fc3e8",
  glassSkyLow: "#c3e0f2",
  frame: "#3f3831",
  signPlate: "#2f2a25",
  signText: "#d8cfc2",
} as const;

export function drawWorld(ctx: CanvasRenderingContext2D, plan: FloorPlan, view: Rect): void {
  drawFloor(ctx, plan, view);
  for (const room of plan.rooms) drawRoomFloor(ctx, room);
  drawStructure(ctx, plan);
  for (const room of plan.rooms) drawRoomFurniture(ctx, plan, room);
  drawCorridorPlants(ctx, plan);
  for (const desk of plan.desks) {
    if (rectsTouch(view, expand(desk.bounds, 40))) drawDesk(ctx, desk.bounds, false);
  }
  for (const room of plan.rooms) drawDoorSign(ctx, room);
  drawEntrance(ctx, plan);
}

/** The monitor screen glass for a desk; the activity glow overlay reuses it. */
export function deskScreenRect(desk: Rect): Rect {
  return { x: desk.x + desk.w / 2 - 13, y: desk.y - 15, w: 26, h: 15 };
}

function drawFloor(ctx: CanvasRenderingContext2D, plan: FloorPlan, view: Rect): void {
  const { w, h } = plan.world;
  ctx.fillStyle = PALETTE.wood;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PALETTE.woodSeam;
  const top = Math.max(0, Math.floor(view.y / 16) * 16);
  const bottom = Math.min(h, view.y + view.h);
  for (let y = top; y < bottom; y += 16) {
    ctx.fillRect(0, y, w, 1);
    const offset = (y / 16) % 2 === 0 ? 0 : 48;
    for (let x = offset; x < w; x += 96) ctx.fillRect(x, y, 1, 16);
  }
  ctx.fillStyle = PALETTE.corridor;
  ctx.fillRect(WALL, 288, plan.world.w - 2 * WALL, 64);
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
  const [tileA, tileB] = room.kind === "snack"
    ? [PALETTE.snackTileA, PALETTE.snackTileB]
    : [PALETTE.restTileA, PALETTE.restTileB];
  for (let ty = 0; ty < b.h; ty += 16) {
    for (let tx = 0; tx < b.w; tx += 16) {
      ctx.fillStyle = ((tx + ty) / 16) % 2 === 0 ? tileA : tileB;
      ctx.fillRect(b.x + tx, b.y + ty, Math.min(16, b.w - tx), Math.min(16, b.h - ty));
    }
  }
}

function drawStructure(ctx: CanvasRenderingContext2D, plan: FloorPlan): void {
  const { w, h } = plan.world;
  ctx.fillStyle = PALETTE.wallFill;
  ctx.fillRect(0, 0, w, WALL);
  ctx.fillRect(0, h - WALL, w, WALL);
  ctx.fillRect(0, WALL, WALL, 280);
  ctx.fillRect(0, 344, WALL, h - 344 - WALL);
  ctx.fillRect(w - WALL, WALL, WALL, h - 2 * WALL);

  for (const room of plan.rooms) {
    const b = room.bounds;
    ctx.fillStyle = PALETTE.wallFace;
    ctx.fillRect(b.x, b.y, b.w, WALL_FACE_H);
    ctx.fillStyle = PALETTE.wallFaceShadow;
    ctx.fillRect(b.x, b.y + WALL_FACE_H - 6, b.w, 6);
    ctx.fillStyle = PALETTE.baseboard;
    ctx.fillRect(b.x, b.y + WALL_FACE_H, b.w, 2);
    drawRoomWindows(ctx, room);
  }

  ctx.fillStyle = PALETTE.wallFill;
  ctx.fillRect(304, WALL, WALL, 272);
  ctx.fillRect(624, WALL, WALL, 272);
  ctx.fillRect(896, WALL, WALL, 272);
  for (const room of plan.rooms) drawSouthWall(ctx, room);
  ctx.fillStyle = PALETTE.wallEdge;
  ctx.fillRect(0, 0, w, 2);
}

function drawSouthWall(ctx: CanvasRenderingContext2D, room: RoomSpec): void {
  const b = room.bounds;
  const y = b.y + b.h;
  const gapL = room.doorCx - 24;
  const gapR = room.doorCx + 24;
  ctx.fillStyle = PALETTE.wallFill;
  ctx.fillRect(b.x - WALL, y, gapL - b.x + WALL, WALL);
  ctx.fillRect(gapR, y, b.x + b.w - gapR + WALL, WALL);
  ctx.fillStyle = PALETTE.wallEdge;
  ctx.fillRect(b.x - WALL, y + WALL - 2, gapL - b.x + WALL, 2);
  ctx.fillRect(gapR, y + WALL - 2, b.x + b.w - gapR + WALL, 2);
  ctx.fillStyle = PALETTE.frame;
  ctx.fillRect(gapL - 3, y, 3, WALL);
  ctx.fillRect(gapR, y, 3, WALL);
}

function drawRoomWindows(ctx: CanvasRenderingContext2D, room: RoomSpec): void {
  for (const rect of windowRects(room)) drawWindowFrame(ctx, rect);
}

/** Window glass rects on each room's north wall face (world coordinates). */
export function windowRects(room: RoomSpec): Rect[] {
  const b = room.bounds;
  const y = b.y + 8;
  const h = WALL_FACE_H - 20;
  if (room.kind === "restroom") {
    return [{ x: b.x + b.w - 190, y: y + 6, w: 44, h: h - 10 }];
  }
  if (room.kind === "snack") {
    return [{ x: b.x + 24, y, w: 72, h }];
  }
  const w = 72;
  return [
    { x: b.x + 28, y, w, h },
    { x: b.x + b.w - 28 - w, y, w, h },
  ];
}

function drawWindowFrame(ctx: CanvasRenderingContext2D, rect: Rect): void {
  ctx.fillStyle = PALETTE.frame;
  ctx.fillRect(rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6);
  const grad = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  grad.addColorStop(0, PALETTE.glassSky);
  grad.addColorStop(1, PALETTE.glassSkyLow);
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = PALETTE.frame;
  ctx.fillRect(rect.x + rect.w / 2 - 1, rect.y, 2, rect.h);
}

function drawRoomFurniture(ctx: CanvasRenderingContext2D, plan: FloorPlan, room: RoomSpec): void {
  if (room.kind === "ceo") drawCeoFurniture(ctx, plan);
  if (room.kind === "meeting") drawMeetingFurniture(ctx);
  if (room.kind === "snack") drawSnackFurniture(ctx);
  if (room.kind === "restroom") drawRestroomFurniture(ctx);
}

function drawCeoFurniture(ctx: CanvasRenderingContext2D, plan: FloorPlan): void {
  const desk = plan.ceoDesk;
  ctx.fillStyle = "#414b6e";
  ctx.fillRect(desk.x - 16, desk.y - 8, desk.w + 32, desk.h + 40);
  drawDesk(ctx, desk, true);
  drawSofa(ctx, 32, 96);
  drawPlant(ctx, 280, 48);
  ctx.fillStyle = PALETTE.frame;
  ctx.fillRect(190, 24, 34, 22);
  ctx.fillStyle = "#7f96b8";
  ctx.fillRect(192, 26, 30, 18);
  ctx.fillStyle = "#5c7a9c";
  ctx.fillRect(192, 36, 30, 8);
}

function drawMeetingFurniture(ctx: CanvasRenderingContext2D): void {
  const table: Rect = { x: 392, y: 120, w: 160, h: 64 };
  ctx.fillStyle = PALETTE.deskWoodDark;
  ctx.fillRect(table.x, table.y, table.w, table.h);
  ctx.fillStyle = PALETTE.deskWood;
  ctx.fillRect(table.x + 3, table.y + 3, table.w - 6, table.h - 9);
  for (let i = 0; i < 3; i++) {
    drawChair(ctx, table.x + 22 + i * 52, table.y - 16);
    drawChair(ctx, table.x + 22 + i * 52, table.y + table.h + 4);
  }
  ctx.fillStyle = "#f2efe8";
  ctx.fillRect(452, 22, 96, 30);
  ctx.fillStyle = PALETTE.frame;
  ctx.strokeStyle = PALETTE.frame;
  ctx.lineWidth = 2;
  ctx.strokeRect(452, 22, 96, 30);
  ctx.fillStyle = "#b3543f";
  ctx.fillRect(460, 30, 26, 3);
  ctx.fillStyle = "#4f7fae";
  ctx.fillRect(460, 38, 40, 3);
  ctx.fillStyle = "#6d9c6b";
  ctx.fillRect(460, 44, 33, 3);
}

function drawSnackFurniture(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#8f8578";
  ctx.fillRect(656, 40, 224, 28);
  ctx.fillStyle = "#a99e8f";
  ctx.fillRect(656, 40, 224, 8);
  ctx.fillStyle = "#d5dade";
  ctx.fillRect(660, 8, 30, 48);
  ctx.fillStyle = "#b9c0c6";
  ctx.fillRect(660, 30, 30, 3);
  ctx.fillRect(682, 14, 4, 12);
  drawCoffeeMachine(ctx, 694, 26);
  ctx.fillStyle = "#c9a86a";
  ctx.fillRect(806, 30, 14, 12);
  ctx.fillStyle = "#b3543f";
  ctx.fillRect(826, 28, 12, 14);
  ctx.fillStyle = "#6d9c6b";
  ctx.fillRect(844, 30, 12, 12);
  ctx.fillStyle = "#94897b";
  ctx.fillRect(748, 170, 40, 40);
  ctx.fillStyle = "#a89d8e";
  ctx.fillRect(751, 173, 34, 34);
  drawStool(ctx, 738, 184);
  drawStool(ctx, 792, 184);
}

function drawCoffeeMachine(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = "#2e3238";
  ctx.fillRect(x, y, 22, 30);
  ctx.fillStyle = "#454b52";
  ctx.fillRect(x + 2, y + 2, 18, 8);
  ctx.fillStyle = "#c9553e";
  ctx.fillRect(x + 8, y + 12, 6, 4);
  ctx.fillStyle = "#d8d3c8";
  ctx.fillRect(x + 7, y + 20, 8, 7);
}

function drawRestroomFurniture(ctx: CanvasRenderingContext2D): void {
  for (let i = 0; i < 3; i++) {
    const x = 1064 + i * 40;
    ctx.fillStyle = "#7d8a99";
    ctx.fillRect(x, 16, 40, 72);
    ctx.fillStyle = "#8f9dad";
    ctx.fillRect(x + 4, 28, 32, 58);
    ctx.fillStyle = "#6c7887";
    ctx.fillRect(x + 30, 54, 4, 8);
  }
  ctx.fillStyle = "#c6d2de";
  ctx.fillRect(928, 32, 96, 32);
  ctx.fillStyle = "#e4ebf2";
  for (let i = 0; i < 2; i++) ctx.fillRect(940 + i * 44, 38, 28, 14);
  ctx.fillStyle = "#aab8c6";
  ctx.fillRect(936, 18, 80, 10);
}

function drawCorridorPlants(ctx: CanvasRenderingContext2D, plan: FloorPlan): void {
  void plan;
  drawPlant(ctx, 312, 300);
  drawPlant(ctx, 632, 300);
  drawPlant(ctx, 904, 300);
}

function drawPlant(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.fillStyle = "#8a5a3b";
  ctx.fillRect(cx - 7, cy, 14, 10);
  ctx.fillStyle = "#4e7a46";
  ctx.fillRect(cx - 9, cy - 12, 18, 12);
  ctx.fillStyle = "#659a58";
  ctx.fillRect(cx - 5, cy - 18, 10, 8);
}

function drawSofa(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = "#7a4a41";
  ctx.fillRect(x, y, 24, 72);
  ctx.fillStyle = "#94594e";
  ctx.fillRect(x + 8, y + 4, 16, 64);
}

function drawChair(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = PALETTE.chairDark;
  ctx.fillRect(x, y, 16, 12);
  ctx.fillStyle = PALETTE.chair;
  ctx.fillRect(x + 2, y + 2, 12, 8);
}

function drawStool(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = "#6d5334";
  ctx.fillRect(x, y, 10, 10);
}

function drawDesk(ctx: CanvasRenderingContext2D, desk: Rect, executive: boolean): void {
  ctx.fillStyle = PALETTE.deskLeg;
  ctx.fillRect(desk.x + 4, desk.y + desk.h - 6, 5, 10);
  ctx.fillRect(desk.x + desk.w - 9, desk.y + desk.h - 6, 5, 10);
  ctx.fillStyle = executive ? "#5f4a33" : PALETTE.deskWoodDark;
  ctx.fillRect(desk.x, desk.y, desk.w, desk.h);
  ctx.fillStyle = executive ? "#75593b" : PALETTE.deskWood;
  ctx.fillRect(desk.x + 2, desk.y + 2, desk.w - 4, desk.h - 7);

  const screen = deskScreenRect(desk);
  ctx.fillStyle = PALETTE.monitorShell;
  ctx.fillRect(screen.x - 2, screen.y - 2, screen.w + 4, screen.h + 4);
  ctx.fillStyle = PALETTE.screenOff;
  ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
  ctx.fillStyle = PALETTE.monitorShell;
  ctx.fillRect(screen.x + screen.w / 2 - 3, screen.y + screen.h + 2, 6, 3);
  if (executive) {
    ctx.fillStyle = "#d8d3c8";
    ctx.fillRect(desk.x + desk.w - 22, desk.y + 8, 12, 8);
    ctx.fillStyle = "#4e7a46";
    ctx.fillRect(desk.x + 8, desk.y + 6, 8, 10);
  }
  ctx.fillStyle = "#23262b";
  ctx.fillRect(desk.x + desk.w / 2 - 8, desk.y + desk.h - 12, 16, 5);
  drawChair(ctx, desk.x + desk.w / 2 - 8, desk.y + desk.h + 4);
}

function drawDoorSign(ctx: CanvasRenderingContext2D, room: RoomSpec): void {
  const label = room.label;
  ctx.font = "bold 8px monospace";
  const width = ctx.measureText(label).width + 10;
  const x = room.doorCx - width / 2;
  const y = room.bounds.y + room.bounds.h - 13;
  ctx.fillStyle = PALETTE.signPlate;
  ctx.fillRect(x, y, width, 12);
  ctx.fillStyle = PALETTE.signText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, room.doorCx, y + 7);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawEntrance(ctx: CanvasRenderingContext2D, plan: FloorPlan): void {
  void plan;
  ctx.fillStyle = PALETTE.frame;
  ctx.fillRect(0, 292, 4, 56);
  ctx.fillStyle = "#7fb3d9";
  ctx.fillRect(4, 296, 4, 48);
  ctx.fillStyle = "#8d6a45";
  ctx.fillRect(20, 300, 26, 40);
  ctx.fillStyle = "#9c7852";
  ctx.fillRect(22, 302, 22, 36);
}

function rectsTouch(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function expand(rect: Rect, margin: number): Rect {
  return { x: rect.x - margin, y: rect.y - margin, w: rect.w + margin * 2, h: rect.h + margin * 2 };
}
