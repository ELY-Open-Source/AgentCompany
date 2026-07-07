import type { AgentActivity, Camera, FloorPlan, Rect } from "./office-types";
import { deskScreenRect, drawWorld } from "./scene-renderer";
import { drawPerson, type Carrying, type Facing, type SpriteAppearance } from "./sprites";

export interface RenderPerson {
  id: string;
  name: string;
  activity: AgentActivity;
  x: number;
  y: number;
  desk: Rect | null;
  isCeo: boolean;
  animSeed: number;
  appearance: SpriteAppearance;
  facing: Facing;
  walkPhase: number;
  carrying: Carrying;
}

const ACTIVITY_DOT: Partial<Record<AgentActivity, string>> = {
  active: "#34d399",
  thinking: "#818cf8",
  busy: "#f59e0b",
};

export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/**
 * Composes one frame: static world under the camera transform, then desks'
 * activity glow, then people (painter's order by y) with full-name labels.
 */
export function renderOffice(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  plan: FloorPlan,
  camera: Camera,
  people: RenderPerson[],
  timeMs: number,
): void {
  ctx.fillStyle = "#14161c";
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  drawWorld(ctx, plan, { x: camera.x, y: camera.y, w: viewW, h: viewH });

  for (const person of people) {
    if (!person.desk) continue;
    if (person.activity !== "active" && person.activity !== "thinking") continue;
    const screen = deskScreenRect(person.desk);
    ctx.fillStyle = "#1c3a2c";
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
    ctx.fillStyle = "#37d38a";
    const lines = 3 + (hashString(person.id) % 3);
    for (let i = 0; i < lines; i++) {
      const width = 6 + ((hashString(person.id) >> (i * 3)) % 14);
      ctx.fillRect(screen.x + 3, screen.y + 3 + i * 3, width, 1);
    }
  }

  const ordered = [...people].sort((a, b) => a.y - b.y);
  for (const person of ordered) {
    const working = (person.activity === "active" || person.activity === "thinking") && person.walkPhase === 0;
    drawPerson(ctx, person.x, person.y, person.appearance, {
      facing: person.facing,
      walkPhase: person.walkPhase,
      working,
      carrying: person.carrying,
      timeMs,
      animSeed: person.animSeed,
    }, person.isCeo);
    const dot = ACTIVITY_DOT[person.activity];
    if (dot) {
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(Math.round(person.x) + 10, Math.round(person.y) - 36, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const person of ordered) drawNameLabel(ctx, person);

  ctx.restore();
}

function drawNameLabel(ctx: CanvasRenderingContext2D, person: RenderPerson): void {
  ctx.font = "600 9px -apple-system, 'Segoe UI', sans-serif";
  const width = Math.ceil(ctx.measureText(person.name).width) + 10;
  const x = Math.round(person.x - width / 2);
  const y = Math.round(person.y + 7);
  ctx.fillStyle = "rgba(22,22,28,0.78)";
  drawRoundedRect(ctx, x, y, width, 13, 4);
  ctx.fillStyle = "#f2f2f5";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(person.name, person.x, y + 7);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.fill();
}
