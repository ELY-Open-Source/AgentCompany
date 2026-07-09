import { HIT_REACT_MS, WHIP_CRACK_MS, type AgentActivity, type Camera, type FloorPlan, type Rect, type WhipCrackEffect } from "./office-types";
import { deskScreenRect, drawWorld } from "./scene-renderer";
import { skyScene } from "./sky";
import { drawPerson, type Carrying, type Facing, type SpriteAppearance } from "./sprites";

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
  /** Remaining flinch time after a whip strike; 0 when unbothered. */
  hitReactMs: number;
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
  clock: Date,
  selectedId: string | null,
  effects: WhipCrackEffect[] = [],
): void {
  ctx.fillStyle = "#14161c";
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  drawWorld(ctx, plan, { x: camera.x, y: camera.y, w: viewW, h: viewH }, skyScene(clock));

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
    if (person.id === selectedId) {
      ctx.strokeStyle = "rgba(94,106,210,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(Math.round(person.x), Math.round(person.y) + 2, 13, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const working = (person.activity === "active" || person.activity === "thinking") && person.walkPhase === 0;
    // A struck agent shakes for the flinch duration, hardest right after the hit.
    const flinchStrength = person.hitReactMs > 0 ? person.hitReactMs / HIT_REACT_MS : 0;
    const shakeX = flinchStrength > 0 ? Math.sin(person.hitReactMs * 0.09) * 2.5 * flinchStrength : 0;
    drawPerson(ctx, person.x + shakeX, person.y, person.appearance, {
      facing: person.facing,
      walkPhase: person.walkPhase,
      working,
      carrying: person.carrying,
      timeMs,
      animSeed: person.animSeed,
    }, person.isCeo);
    if (flinchStrength > 0) drawPainMarks(ctx, person.x + shakeX, person.y, flinchStrength);
    const dot = ACTIVITY_DOT[person.activity];
    if (dot) {
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(Math.round(person.x) + 10, Math.round(person.y) - 36, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const person of ordered) drawNameLabel(ctx, person);
  for (const effect of effects) drawWhipCrack(ctx, effect);

  ctx.restore();
}

/** Anime-style pain sparks over a flinching agent's head. */
function drawPainMarks(ctx: CanvasRenderingContext2D, x: number, y: number, strength: number): void {
  ctx.save();
  ctx.globalAlpha = Math.min(1, strength * 1.3);
  ctx.strokeStyle = "#ff5d5d";
  ctx.lineWidth = 1.5;
  const headY = y - 42;
  for (const [dx, angle] of [[-9, 2.4], [9, 0.7], [0, 1.55]] as Array<[number, number]>) {
    const cx = x + dx;
    const cy = headY - Math.abs(dx) * 0.2;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(angle) * 3, cy - Math.sin(angle) * 3);
    ctx.lineTo(cx + Math.cos(angle) * 3, cy + Math.sin(angle) * 3);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The strike itself: a lash sweeping in from the upper right that collapses
 * into an impact starburst with an expanding ring, all gone in under half a
 * second.
 */
function drawWhipCrack(ctx: CanvasRenderingContext2D, effect: WhipCrackEffect): void {
  const progress = Math.min(1, effect.ageMs / WHIP_CRACK_MS);
  ctx.save();

  if (progress < 0.4) {
    // Lash phase: a tapered stroke whipping down toward the target.
    const sweep = progress / 0.4;
    const startX = effect.x + 34 - sweep * 10;
    const startY = effect.y - 34 + sweep * 6;
    ctx.strokeStyle = "#ffe9a3";
    ctx.lineWidth = 2.5 - sweep;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(effect.x + 18 - sweep * 6, effect.y - 26, effect.x + sweep * 2, effect.y - sweep * 2);
    ctx.stroke();
  }

  // Impact starburst, brightest at contact, shrinking as it fades.
  const fade = 1 - progress;
  const reach = 5 + progress * 9;
  ctx.globalAlpha = fade;
  ctx.strokeStyle = progress < 0.25 ? "#ffffff" : "#ffd75e";
  ctx.lineWidth = 1.5;
  for (let ray = 0; ray < 6; ray++) {
    const angle = (Math.PI / 3) * ray + 0.4;
    ctx.beginPath();
    ctx.moveTo(effect.x + Math.cos(angle) * 3, effect.y + Math.sin(angle) * 3);
    ctx.lineTo(effect.x + Math.cos(angle) * reach, effect.y + Math.sin(angle) * reach);
    ctx.stroke();
  }
  ctx.globalAlpha = fade * 0.55;
  ctx.beginPath();
  ctx.arc(effect.x, effect.y, 4 + progress * 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawNameLabel(ctx: CanvasRenderingContext2D, person: RenderPerson): void {
  ctx.font = "600 9px -apple-system, 'Segoe UI', sans-serif";
  const width = Math.ceil(ctx.measureText(person.name).width) + 10;
  const x = Math.round(person.x - width / 2);
  const y = Math.round(person.y + 7);
  ctx.fillStyle = person.isPlayer ? "rgba(94,106,210,0.92)" : "rgba(22,22,28,0.78)";
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
