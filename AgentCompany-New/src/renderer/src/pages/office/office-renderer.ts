import type { AgentActivity, Camera, FloorPlan, Rect } from "./office-types";
import { deskScreenRect, drawWorld } from "./scene-renderer";

export interface RenderPerson {
  id: string;
  name: string;
  activity: AgentActivity;
  x: number;
  y: number;
  desk: Rect | null;
  isCeo: boolean;
  animSeed: number;
}

const ACTIVITY_DOT: Partial<Record<AgentActivity, string>> = {
  active: "#34d399",
  thinking: "#818cf8",
  busy: "#f59e0b",
};

const FACE_TONES = ["#f3c99f", "#e8b184", "#d29b6e", "#b57e4f", "#95603a", "#7c4d2f"];
const SHIRT_COLORS = ["#5b8dd9", "#d95b7a", "#5bbf6f", "#d9a65b", "#9b6fd9", "#5bc4c4", "#d97b5b", "#7fd95b"];

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
  for (const person of ordered) drawPerson(ctx, person, timeMs);
  for (const person of ordered) drawNameLabel(ctx, person);

  ctx.restore();
}

function drawPerson(ctx: CanvasRenderingContext2D, person: RenderPerson, timeMs: number): void {
  const x = Math.round(person.x);
  const working = person.activity === "active" || person.activity === "thinking";
  const bob = working ? Math.sin(timeMs * 0.003 + person.animSeed) * 1.2 : 0;
  const y = Math.round(person.y + bob);

  const face = FACE_TONES[hashString(person.id) % FACE_TONES.length];
  const shirt = person.isCeo ? "#37415c" : SHIRT_COLORS[hashString(person.id + person.name) % SHIRT_COLORS.length];

  ctx.fillStyle = "rgba(20,16,12,0.25)";
  ctx.fillRect(x - 8, y + 2, 16, 4);

  ctx.fillStyle = "#3a3f47";
  ctx.fillRect(x - 5, y - 7, 4, 8);
  ctx.fillRect(x + 1, y - 7, 4, 8);

  ctx.fillStyle = shirt;
  ctx.fillRect(x - 8, y - 20, 16, 13);
  ctx.fillStyle = face;
  ctx.fillRect(x - 10, y - 18, 3, 7);
  ctx.fillRect(x + 7, y - 18, 3, 7);

  ctx.fillStyle = face;
  ctx.fillRect(x - 7, y - 32, 14, 12);
  ctx.fillStyle = "#2c2320";
  ctx.fillRect(x - 8, y - 34, 16, 5);
  ctx.fillRect(x - 8, y - 31, 3, 4);
  ctx.fillRect(x + 5, y - 31, 3, 4);

  ctx.fillStyle = "#1d1d22";
  ctx.fillRect(x - 4, y - 27, 2, 2);
  ctx.fillRect(x + 2, y - 27, 2, 2);

  const dot = ACTIVITY_DOT[person.activity];
  if (dot) {
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(x + 10, y - 36, 3, 0, Math.PI * 2);
    ctx.fill();
  }
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
