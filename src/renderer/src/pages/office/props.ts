import type { Rect } from "./office-types";
import { drawBox, setSouthFaceTransform, toIso, type IsoFrame } from "./iso";

/** Hand angles in radians, clockwise from twelve, for a local time. */
export function clockHands(date: Date): { hour: number; minute: number } {
  const minutes = date.getMinutes();
  return {
    hour: (((date.getHours() % 12) + minutes / 60) / 12) * 2 * Math.PI,
    minute: (minutes / 60) * 2 * Math.PI,
  };
}

/** A 16-pixel wall clock in wall-face coordinates (x along the wall, y down), showing the real time. */
export function drawWallClock(ctx: CanvasRenderingContext2D, x: number, y: number, date: Date): void {
  ctx.fillStyle = "#3f3831";
  ctx.fillRect(x + 2, y, 12, 16);
  ctx.fillRect(x, y + 2, 16, 12);
  ctx.fillStyle = "#f2efe8";
  ctx.fillRect(x + 2, y + 2, 12, 12);
  ctx.fillStyle = "#8a8378";
  for (const [tx, ty] of [[7, 2], [12, 7], [7, 12], [2, 7]] as const) ctx.fillRect(x + tx, y + ty, 2, 1);
  const hands = clockHands(date);
  hand(ctx, x + 8, y + 8, hands.minute, 5, "#2b2622");
  hand(ctx, x + 8, y + 8, hands.hour, 3, "#b3543f");
}

function hand(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, length: number, color: string): void {
  ctx.fillStyle = color;
  for (let step = 0; step <= length; step++) {
    ctx.fillRect(Math.round(cx + Math.sin(angle) * step - 0.5), Math.round(cy - Math.cos(angle) * step - 0.5), 1, 1);
  }
}

/** A desk monitor's screen on its south face: scrolling code and a blinking cursor while its agent works, a standby light otherwise. */
export function drawMonitorScreen(ctx: CanvasRenderingContext2D, frame: IsoFrame, monitor: Rect, z: number, height: number, on: boolean, timeMs: number, seed: number): void {
  ctx.save();
  setSouthFaceTransform(ctx, frame, monitor.y + monitor.h, z + height);
  const glass = { x: monitor.x + 2, y: 2, w: monitor.w - 4, h: height - 4 };
  ctx.fillStyle = on ? "#0f2a1c" : "#20242c";
  ctx.fillRect(glass.x, glass.y, glass.w, glass.h);
  if (on) {
    const scroll = Math.floor(timeMs / 350);
    ctx.fillStyle = "#37d38a";
    for (let row = 0; row < 4; row++) {
      const width = 4 + ((seed * 7 + (scroll + row) * 13) % (glass.w - 6));
      ctx.fillRect(glass.x + 1 + (row % 2) * 2, glass.y + 1 + row * 2, width, 1);
    }
    if (Math.floor(timeMs / 500) % 2 === 0) ctx.fillRect(glass.x + glass.w - 3, glass.y + glass.h - 2, 2, 1);
  } else {
    ctx.fillStyle = "#e0a23a";
    ctx.fillRect(glass.x + glass.w - 2, glass.y + glass.h - 1, 1, 1);
  }
  ctx.restore();
}

/** The snack bar's coffee machine: body, cap, a lit button and a cup, with steam curling up from the cup. */
export function drawCoffeeMachine(ctx: CanvasRenderingContext2D, frame: IsoFrame, foot: Rect, z: number, timeMs: number): void {
  drawBox(ctx, frame, foot, z, 14, { top: "#454b52", south: "#2e3238", east: "#23262b" });
  drawBox(ctx, frame, { x: foot.x + 1, y: foot.y + 1, w: foot.w - 2, h: 5 }, z + 14, 3, { top: "#5a616a", south: "#3c4249", east: "#30353b" });
  ctx.save();
  setSouthFaceTransform(ctx, frame, foot.y + foot.h, z + 14);
  ctx.fillStyle = Math.floor(timeMs / 700) % 2 === 0 ? "#e2553b" : "#8f3426";
  ctx.fillRect(foot.x + 2, 2, 2, 2);
  ctx.fillStyle = "#d8d3c8";
  ctx.fillRect(foot.x + foot.w / 2 - 2, 9, 4, 4);
  ctx.restore();
  const cup = toIso(frame, { x: foot.x + foot.w / 2, y: foot.y + foot.h }, z + 6);
  for (let puff = 0; puff < 3; puff++) {
    const rise = ((timeMs / 120 + puff * 5) % 15);
    ctx.fillStyle = `rgba(242,242,245,${0.75 * (1 - rise / 15)})`;
    ctx.fillRect(Math.round(cup.x + Math.sin((rise + puff) / 2) * 1.5), Math.round(cup.y - 4 - rise), 1, 1);
  }
}

/** A toilet against the back wall: tank and bowl in porcelain white, the bowl's opening shaded. */
export function drawToilet(ctx: CanvasRenderingContext2D, frame: IsoFrame, cx: number, backY: number): void {
  const porcelain = { top: "#f4f6f8", south: "#d9dee4", east: "#c3c9d0" };
  drawBox(ctx, frame, { x: cx - 6, y: backY, w: 12, h: 5 }, 0, 16, porcelain);
  drawBox(ctx, frame, { x: cx - 5, y: backY + 5, w: 10, h: 11 }, 0, 8, porcelain);
  drawBox(ctx, frame, { x: cx - 3, y: backY + 7, w: 6, h: 7 }, 8, 0, { top: "#9fb2c4", south: "#9fb2c4", east: "#9fb2c4" });
}

/** A wash basin set into a counter top at height `z`: a pale rim around a shaded bowl. */
export function drawBasin(ctx: CanvasRenderingContext2D, frame: IsoFrame, basin: Rect, z: number): void {
  drawBox(ctx, frame, basin, z, 0, { top: "#e4ebf2", south: "#e4ebf2", east: "#e4ebf2" });
  drawBox(ctx, frame, { x: basin.x + 4, y: basin.y + 3, w: basin.w - 8, h: basin.h - 6 }, z, 0, { top: "#8fa3b7", south: "#8fa3b7", east: "#8fa3b7" });
}
