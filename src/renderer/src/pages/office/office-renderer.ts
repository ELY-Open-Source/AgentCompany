import type { AgentActivity, Camera, FloorPlan, Rect } from "./office-types";
import { drawBackWalls, drawGround, sceneDrawables, type Drawable } from "./scene-renderer";
import { depthOf, toIso, type IsoFrame } from "./iso";
import { skyScene } from "./sky";
import { drawPerson, type Carrying, type Facing, type SpriteAppearance } from "./sprites";
import type { DayPart, Season } from "../../shared/palette-clock";

export interface RenderPerson {
  id: string;
  name: string;
  activity: AgentActivity;
  x: number;
  y: number;
  desk: Rect | null;
  isCeo: boolean;
  isPlayer: boolean;
  animSeed: number;
  appearance: SpriteAppearance;
  facing: Facing;
  walkPhase: number;
  carrying: Carrying;
}

/** One frame's inputs: the scene in iso pixels, and how those pixels land on the screen. */
export interface OfficeFrame {
  frame: IsoFrame;
  plan: FloorPlan;
  /** Camera top-left, in iso pixels. */
  camera: Camera;
  /** CSS px per iso pixel. */
  pixel: number;
  /** CSS px per pixel-font pixel, for the crisp text drawn over the scene. */
  fontScale: number;
  viewW: number;
  viewH: number;
  people: RenderPerson[];
  timeMs: number;
  clock: Date;
  dayPart: DayPart;
  season: Season;
  selectedId: string | null;
}

const ACTIVITY_DOT: Partial<Record<AgentActivity, string>> = {
  active: "#34d399",
  thinking: "#818cf8",
  busy: "#f59e0b",
};

/** The day part washes over the whole floor: warm at dawn and dusk, blue at night. */
const DAY_TINT: Record<DayPart, string | null> = {
  dawn: "#f3d9d6",
  day: null,
  dusk: "#f0c6a0",
  night: "#7d8bc0",
};

export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/** Draws the scene at iso-pixel resolution on `scene`, depth-sorted, then scales it up unsmoothed onto `ctx` and writes labels in the pixel font. */
export function renderOffice(ctx: CanvasRenderingContext2D, scene: HTMLCanvasElement, input: OfficeFrame): void {
  const sceneW = Math.ceil(input.viewW / input.pixel);
  const sceneH = Math.ceil(input.viewH / input.pixel);
  if (scene.width !== sceneW || scene.height !== sceneH) {
    scene.width = sceneW;
    scene.height = sceneH;
  }
  const sctx = scene.getContext("2d");
  if (!sctx) throw new Error("The office scene canvas has no 2D context.");
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.fillStyle = "#14161c";
  sctx.fillRect(0, 0, sceneW, sceneH);
  sctx.translate(-Math.round(input.camera.x), -Math.round(input.camera.y));

  drawGround(sctx, input.frame, input.plan);
  drawBackWalls(sctx, input.frame, input.plan, skyScene(input.clock));
  const lit = new Set(input.people.filter((person) => person.desk && (person.activity === "active" || person.activity === "thinking")).map((person) => person.desk!));
  const items: Drawable[] = [...sceneDrawables(input.frame, input.plan, input.season, lit), ...input.people.map((person) => personDrawable(input, person))];
  items.sort((a, b) => a.depth - b.depth);
  for (const item of items) item.draw(sctx);

  const tint = DAY_TINT[input.dayPart];
  if (tint) {
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = "multiply";
    sctx.fillStyle = tint;
    sctx.fillRect(0, 0, sceneW, sceneH);
    sctx.globalCompositeOperation = "source-over";
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scene, 0, 0, sceneW * input.pixel, sceneH * input.pixel);
  drawLabels(ctx, input);
}

function personDrawable(input: OfficeFrame, person: RenderPerson): Drawable {
  return {
    // Just in front of anything sharing the same footprint centre.
    depth: depthOf(person) + 0.5,
    draw: (ctx) => {
      const feet = toIso(input.frame, person);
      if (person.id === input.selectedId) {
        ctx.fillStyle = "rgba(94,106,210,0.9)";
        ctx.fillRect(Math.round(feet.x) - 12, Math.round(feet.y), 24, 2);
        ctx.fillRect(Math.round(feet.x) - 14, Math.round(feet.y) - 2, 2, 2);
        ctx.fillRect(Math.round(feet.x) + 12, Math.round(feet.y) - 2, 2, 2);
      }
      const working = (person.activity === "active" || person.activity === "thinking") && person.walkPhase === 0;
      drawPerson(ctx, feet.x, feet.y, person.appearance, {
        facing: person.facing,
        walkPhase: person.walkPhase,
        working,
        carrying: person.carrying,
        timeMs: input.timeMs,
        animSeed: person.animSeed,
      }, person.isCeo);
      const dot = ACTIVITY_DOT[person.activity];
      if (dot) {
        ctx.fillStyle = dot;
        ctx.fillRect(Math.round(feet.x) + 8, Math.round(feet.y) - 40, 4, 4);
      }
    },
  };
}

/** Names under people and room signs over doors, in the pixel font at screen resolution so they stay crisp. */
function drawLabels(ctx: CanvasRenderingContext2D, input: OfficeFrame): void {
  const size = 12 * input.fontScale;
  ctx.font = `${size}px "Fusion Pixel"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const screen = (x: number, y: number, z = 0) => {
    const iso = toIso(input.frame, { x, y }, z);
    return { x: Math.round((iso.x - Math.round(input.camera.x)) * input.pixel), y: Math.round((iso.y - Math.round(input.camera.y)) * input.pixel) };
  };
  for (const room of input.plan.rooms) {
    const at = screen(room.doorCx, room.bounds.y + room.bounds.h, 22);
    plate(ctx, room.label, at.x, at.y - size, size, "rgba(47,42,37,0.9)");
  }
  for (const person of [...input.people].sort((a, b) => depthOf(a) - depthOf(b))) {
    const at = screen(person.x, person.y);
    plate(ctx, person.name, at.x, at.y + 6 * input.pixel, size, person.isPlayer ? "rgba(94,106,210,0.92)" : "rgba(22,22,28,0.78)");
  }
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function plate(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, size: number, background: string): void {
  const width = Math.ceil(ctx.measureText(text).width) + size;
  ctx.fillStyle = background;
  ctx.fillRect(Math.round(cx - width / 2), top, width, Math.round(size * 1.5));
  ctx.fillStyle = "#f2f2f5";
  ctx.fillText(text, cx, top + Math.round(size * 0.25));
}
