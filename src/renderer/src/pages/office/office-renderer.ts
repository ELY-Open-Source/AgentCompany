import type { Camera, FloorPlan, Rect } from "./office-types";
import type { OfficeState } from "./agent-state";
import { drawBackWalls, drawContactShadows, drawGround, sceneDrawables, windowRects, type Drawable } from "./scene-renderer";
import { depthOf, toIso, type IsoFrame } from "./iso";
import { applyLighting, sceneLights, sunPatches } from "./lighting";
import { skyScene, weatherFor } from "./sky";
import { drawPerson, type Carrying, type Facing, type SpriteAppearance } from "./sprites";
import type { DayPart, Season } from "../../shared/palette-clock";

export interface RenderPerson {
  id: string;
  name: string;
  state: OfficeState;
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
  /** Scene pixels per iso pixel (artScale). */
  art: number;
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

/** Marker over the head: green running, grey queued, amber cooling down, red blocked; none when idle. */
const STATE_MARK: Partial<Record<OfficeState, string>> = {
  running: "#34d399",
  queued: "#9aa3b2",
  cooldown: "#f59e0b",
  blocked: "#ef4444",
};

export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/** Draws the scene at art resolution on `scene`, depth-sorted and lit for the hour, then scales it up unsmoothed onto `ctx` and writes labels in the pixel font. */
export function renderOffice(ctx: CanvasRenderingContext2D, scene: HTMLCanvasElement, lightMap: HTMLCanvasElement, input: OfficeFrame): void {
  const sceneW = Math.ceil((input.viewW / input.pixel) * input.art);
  const sceneH = Math.ceil((input.viewH / input.pixel) * input.art);
  if (scene.width !== sceneW || scene.height !== sceneH) {
    scene.width = sceneW;
    scene.height = sceneH;
  }
  const sctx = scene.getContext("2d");
  if (!sctx) throw new Error("The office scene canvas has no 2D context.");
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.imageSmoothingEnabled = false;
  sctx.fillStyle = "#14161c";
  sctx.fillRect(0, 0, sceneW, sceneH);
  const camera = snappedCamera(input);
  sctx.setTransform(input.art, 0, 0, input.art, -camera.x * input.art, -camera.y * input.art);

  drawGround(sctx, input.frame, input.plan);
  drawBackWalls(sctx, input.frame, input.plan, { sky: skyScene(input.clock), weather: weatherFor(input.clock), clock: input.clock, timeMs: input.timeMs });
  const screens = new Map(input.people.filter((person) => person.desk).map((person) => [person.desk!, person.state]));
  const scenery = sceneDrawables(input.frame, input.plan, input.season, screens, input.timeMs);
  drawContactShadows(sctx, input.frame, scenery);
  const items: Drawable[] = [...scenery, ...input.people.map((person) => personDrawable(input, person))];
  items.sort((a, b) => a.depth - b.depth);
  for (const item of items) item.draw(sctx);

  applyLighting(sctx, lightMap, {
    frame: input.frame,
    camera,
    art: input.art,
    dayPart: input.dayPart,
    lights: sceneLights(input.plan, screens),
    patches: sunPatches(input.plan.rooms.flatMap(windowRects), input.clock),
    timeMs: input.timeMs,
  });

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scene, 0, 0, (sceneW * input.pixel) / input.art, (sceneH * input.pixel) / input.art);
  drawLabels(ctx, input, camera);
}

/** The camera on the scene's pixel grid, so the scene and the labels over it move together. */
function snappedCamera(input: OfficeFrame): Camera {
  return { x: Math.round(input.camera.x * input.art) / input.art, y: Math.round(input.camera.y * input.art) / input.art };
}

function personDrawable(input: OfficeFrame, person: RenderPerson): Drawable {
  return {
    // Just in front of anything sharing the same footprint centre.
    depth: depthOf(person) + 0.5,
    draw: (ctx) => {
      const feet = toIso(input.frame, person);
      if (person.id === input.selectedId) drawSelection(ctx, feet.x, feet.y, input.timeMs);
      const working = person.state === "running" && person.walkPhase === 0;
      drawPerson(ctx, feet.x, feet.y, person.appearance, {
        facing: person.facing,
        walkPhase: person.walkPhase,
        working,
        carrying: person.carrying,
        timeMs: input.timeMs,
        animSeed: person.animSeed,
      }, person.isCeo);
      const gem = STATE_MARK[person.state];
      if (gem) drawStateGem(ctx, feet.x, feet.y - 38 + Math.round(Math.sin(input.timeMs / 420 + person.animSeed) * 2) / 2, gem);
    },
  };
}

/** A small faceted gem floating over the head, in the state's colour. */
function drawStateGem(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const cx = Math.round(x * 2) / 2;
  const rows = [0.5, 1.5, 2.5, 2.5, 1.5, 1, 0.5];
  ctx.fillStyle = "rgba(20,18,24,0.85)";
  rows.forEach((half, row) => ctx.fillRect(cx - half - 0.5, y + row * 0.5 - 0.5, half * 2 + 1, 1));
  ctx.fillStyle = color;
  rows.forEach((half, row) => ctx.fillRect(cx - half, y + row * 0.5, half * 2, 0.5));
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillRect(cx - 1, y + 1, 0.5, 0.5);
  ctx.fillRect(cx - 0.5, y + 0.5, 0.5, 0.5);
}

/** A pixel ring around the selected person's feet, breathing in and out. */
function drawSelection(ctx: CanvasRenderingContext2D, x: number, y: number, timeMs: number): void {
  const grow = Math.round((Math.sin(timeMs / 260) + 1) * 0.5) * 0.5;
  const cx = Math.round(x * 2) / 2;
  const cy = Math.round(y * 2) / 2;
  const rx = 9 + grow;
  ctx.fillStyle = "rgba(124,138,240,0.95)";
  for (let step = 0; step < 48; step++) {
    const angle = (step / 48) * 2 * Math.PI;
    ctx.fillRect(Math.round((cx + Math.cos(angle) * rx) * 2) / 2, Math.round((cy + Math.sin(angle) * rx * 0.5) * 2) / 2, 0.5, 0.5);
  }
}

/** Names under people and room signs over doors, in the pixel font at screen resolution so they stay crisp. */
function drawLabels(ctx: CanvasRenderingContext2D, input: OfficeFrame, camera: Camera): void {
  const size = 12 * input.fontScale;
  ctx.font = `${size}px "Fusion Pixel"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const screen = (x: number, y: number, z = 0) => {
    const iso = toIso(input.frame, { x, y }, z);
    return { x: Math.round((iso.x - camera.x) * input.pixel), y: Math.round((iso.y - camera.y) * input.pixel) };
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
