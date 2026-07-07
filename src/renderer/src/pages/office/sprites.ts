/**
 * Deterministic pixel people. Every agent gets a stable appearance derived
 * from identity (skin tone, hair style and color, outfit, glasses), drawn
 * procedurally with facing-aware variants and a two-frame walk cycle, so no
 * two colleagues read as clones and nobody ships binary sprite sheets.
 */

export type Facing = "north" | "south" | "east" | "west";
export type HairStyle = "buzz" | "short" | "bob" | "long" | "ponytail" | "curly" | "bald";
export type Outfit = "tee" | "hoodie" | "blazer";
export type Carrying = "coffee" | "snack" | null;

export interface SpriteAppearance {
  skin: string;
  hairStyle: HairStyle;
  hair: string;
  outfit: Outfit;
  shirt: string;
  accent: string;
  glasses: boolean;
}

export interface PersonPose {
  facing: Facing;
  /** Radians accumulated while walking; 0 means standing still. */
  walkPhase: number;
  /** Seated work bob (used at desks). */
  working: boolean;
  carrying: Carrying;
  timeMs: number;
  animSeed: number;
}

const SKIN_TONES = ["#f3cfa6", "#eab88a", "#d9a06c", "#b97f4e", "#96613a", "#7a4c2d"];
const HAIR_COLORS = ["#241f1c", "#3c2e22", "#59422c", "#7a512f", "#a8783d", "#c9a05a", "#8d8d92", "#7c3626"];
const HAIR_STYLES: HairStyle[] = ["buzz", "short", "bob", "long", "ponytail", "curly", "bald"];
const SHIRT_COLORS = [
  "#5b8dd9", "#d95b7a", "#54b06a", "#d9a65b", "#9b6fd9",
  "#4fb8b8", "#d97b5b", "#7ba95a", "#c4566f", "#6a7dd9",
];
const ACCENT_COLORS = ["#e5c65a", "#d95b5b", "#5bd9c0", "#c9c9d4", "#8ad95b"];
const BLAZER = "#37415c";
const BLAZER_CEO = "#2c3448";
const PANTS = "#3a3f47";
const SHOES = "#26292e";

export function hashIdentity(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(values: T[], hash: number, salt: number): T {
  return values[(hash >>> salt) % values.length];
}

export function appearanceFor(id: string, isCeo: boolean): SpriteAppearance {
  const hash = hashIdentity(id);
  return {
    skin: pick(SKIN_TONES, hash, 0),
    hairStyle: isCeo ? "short" : pick(HAIR_STYLES, hash, 3),
    hair: pick(HAIR_COLORS, hash, 7),
    outfit: isCeo ? "blazer" : pick<Outfit>(["tee", "tee", "hoodie", "hoodie", "tee", "blazer"], hash, 11),
    shirt: pick(SHIRT_COLORS, hash, 13),
    accent: pick(ACCENT_COLORS, hash, 17),
    glasses: (hash >>> 5) % 100 < 28,
  };
}

/** Draws a person anchored at foot-center (x, y). Total height ~34px. */
export function drawPerson(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  appearance: SpriteAppearance,
  pose: PersonPose,
  isCeo: boolean,
): void {
  const px = Math.round(x);
  const walking = pose.walkPhase !== 0;
  const stride = walking ? Math.sin(pose.walkPhase) * 2.5 : 0;
  const bob = pose.working
    ? Math.sin(pose.timeMs * 0.003 + pose.animSeed) * 1.2
    : walking ? Math.abs(Math.sin(pose.walkPhase)) * -1 : 0;
  const py = Math.round(y + bob);

  ctx.fillStyle = "rgba(24,18,12,0.28)";
  ctx.fillRect(px - 8, Math.round(y) + 1, 16, 4);

  drawLegs(ctx, px, py, stride);
  drawTorso(ctx, px, py, appearance, pose, isCeo);
  drawHead(ctx, px, py, appearance, pose.facing);
  if (pose.carrying) drawCarriedItem(ctx, px, py, pose.carrying, pose.facing);
}

function drawLegs(ctx: CanvasRenderingContext2D, x: number, y: number, stride: number): void {
  const left = Math.round(stride);
  const right = Math.round(-stride);
  ctx.fillStyle = PANTS;
  ctx.fillRect(x - 5, y - 8 + Math.max(0, -left), 4, 8 - Math.abs(Math.min(left, 0)));
  ctx.fillRect(x + 1, y - 8 + Math.max(0, -right), 4, 8 - Math.abs(Math.min(right, 0)));
  ctx.fillStyle = SHOES;
  ctx.fillRect(x - 6, y - 2 + (left > 0 ? -left : 0), 5, 3);
  ctx.fillRect(x + 1, y - 2 + (right > 0 ? -right : 0), 5, 3);
}

function drawTorso(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  appearance: SpriteAppearance,
  pose: PersonPose,
  isCeo: boolean,
): void {
  const top = y - 20;
  if (appearance.outfit === "blazer") {
    ctx.fillStyle = isCeo ? BLAZER_CEO : BLAZER;
    ctx.fillRect(x - 8, top, 16, 12);
    if (pose.facing !== "north") {
      ctx.fillStyle = "#e8e6df";
      ctx.fillRect(x - 2, top, 4, 7);
      ctx.fillStyle = appearance.accent;
      ctx.fillRect(x - 1, top + 1, 2, 6);
    }
    ctx.fillStyle = isCeo ? BLAZER_CEO : BLAZER;
    ctx.fillRect(x - 10, top + 1, 2, 9);
    ctx.fillRect(x + 8, top + 1, 2, 9);
    ctx.fillStyle = appearance.skin;
    ctx.fillRect(x - 10, top + 10, 2, 2);
    ctx.fillRect(x + 8, top + 10, 2, 2);
    return;
  }
  if (appearance.outfit === "hoodie") {
    ctx.fillStyle = appearance.shirt;
    ctx.fillRect(x - 8, top, 16, 12);
    ctx.fillRect(x - 10, top + 1, 2, 9);
    ctx.fillRect(x + 8, top + 1, 2, 9);
    ctx.fillStyle = shade(appearance.shirt);
    ctx.fillRect(x - 8, top, 16, 3);
    if (pose.facing !== "north") ctx.fillRect(x - 4, top + 7, 8, 4);
    ctx.fillStyle = appearance.skin;
    ctx.fillRect(x - 10, top + 10, 2, 2);
    ctx.fillRect(x + 8, top + 10, 2, 2);
    return;
  }
  ctx.fillStyle = appearance.shirt;
  ctx.fillRect(x - 8, top, 16, 12);
  ctx.fillRect(x - 10, top + 1, 2, 4);
  ctx.fillRect(x + 8, top + 1, 2, 4);
  ctx.fillStyle = appearance.skin;
  ctx.fillRect(x - 10, top + 5, 2, 7);
  ctx.fillRect(x + 8, top + 5, 2, 7);
}

function drawHead(ctx: CanvasRenderingContext2D, x: number, y: number, appearance: SpriteAppearance, facing: Facing): void {
  const top = y - 33;
  ctx.fillStyle = appearance.skin;
  ctx.fillRect(x - 7, top, 14, 13);

  if (facing === "north") {
    if (appearance.hairStyle !== "bald") {
      ctx.fillStyle = appearance.hair;
      ctx.fillRect(x - 7, top, 14, 9);
    }
    drawHairEdges(ctx, x, y, appearance, facing);
    return;
  }

  drawHairEdges(ctx, x, y, appearance, facing);
  ctx.fillStyle = "#23232a";
  if (facing === "south") {
    ctx.fillRect(x - 4, top + 6, 2, 2);
    ctx.fillRect(x + 2, top + 6, 2, 2);
  } else if (facing === "east") {
    ctx.fillRect(x + 3, top + 6, 2, 2);
  } else {
    ctx.fillRect(x - 5, top + 6, 2, 2);
  }
  if (appearance.glasses) drawGlasses(ctx, x, top, facing);
}

function drawHairEdges(ctx: CanvasRenderingContext2D, x: number, y: number, appearance: SpriteAppearance, facing: Facing): void {
  const top = y - 33;
  if (appearance.hairStyle === "bald") return;
  ctx.fillStyle = appearance.hair;
  switch (appearance.hairStyle) {
    case "buzz":
      ctx.fillRect(x - 7, top, 14, 3);
      break;
    case "short":
      ctx.fillRect(x - 7, top, 14, 4);
      ctx.fillRect(x - 7, top + 4, 2, 3);
      ctx.fillRect(x + 5, top + 4, 2, 3);
      break;
    case "bob":
      ctx.fillRect(x - 7, top, 14, 4);
      ctx.fillRect(x - 8, top + 2, 2, 9);
      ctx.fillRect(x + 6, top + 2, 2, 9);
      break;
    case "long":
      ctx.fillRect(x - 7, top, 14, 4);
      ctx.fillRect(x - 9, top + 2, 3, 15);
      ctx.fillRect(x + 6, top + 2, 3, 15);
      break;
    case "ponytail":
      ctx.fillRect(x - 7, top, 14, 4);
      if (facing === "north") ctx.fillRect(x - 2, top + 4, 4, 10);
      else if (facing === "east") ctx.fillRect(x - 9, top + 3, 3, 8);
      else if (facing === "west") ctx.fillRect(x + 6, top + 3, 3, 8);
      else ctx.fillRect(x + 6, top + 1, 2, 5);
      break;
    case "curly":
      ctx.fillRect(x - 7, top, 14, 4);
      for (let i = 0; i < 7; i++) ctx.fillRect(x - 7 + i * 2, top + 3 + (i % 2), 2, 2);
      break;
  }
}

function drawGlasses(ctx: CanvasRenderingContext2D, x: number, headTop: number, facing: Facing): void {
  ctx.fillStyle = "#1c1c22";
  if (facing === "south") {
    ctx.fillRect(x - 5, headTop + 5, 4, 1);
    ctx.fillRect(x + 1, headTop + 5, 4, 1);
    ctx.fillRect(x - 5, headTop + 8, 4, 1);
    ctx.fillRect(x + 1, headTop + 8, 4, 1);
    ctx.fillRect(x - 5, headTop + 5, 1, 4);
    ctx.fillRect(x - 2, headTop + 5, 1, 4);
    ctx.fillRect(x + 1, headTop + 5, 1, 4);
    ctx.fillRect(x + 4, headTop + 5, 1, 4);
    ctx.fillRect(x - 1, headTop + 6, 2, 1);
  } else if (facing === "east") {
    ctx.fillRect(x + 2, headTop + 5, 4, 1);
    ctx.fillRect(x + 2, headTop + 8, 4, 1);
    ctx.fillRect(x + 2, headTop + 5, 1, 4);
    ctx.fillRect(x + 5, headTop + 5, 1, 4);
  } else if (facing === "west") {
    ctx.fillRect(x - 6, headTop + 5, 4, 1);
    ctx.fillRect(x - 6, headTop + 8, 4, 1);
    ctx.fillRect(x - 6, headTop + 5, 1, 4);
    ctx.fillRect(x - 3, headTop + 5, 1, 4);
  }
}

function drawCarriedItem(ctx: CanvasRenderingContext2D, x: number, y: number, item: Carrying, facing: Facing): void {
  const side = facing === "west" ? -12 : 10;
  const ix = x + side;
  const iy = y - 14;
  if (item === "coffee") {
    ctx.fillStyle = "#f0ece2";
    ctx.fillRect(ix, iy, 4, 5);
    ctx.fillStyle = "#6b4a2f";
    ctx.fillRect(ix, iy, 4, 1);
    ctx.fillStyle = "rgba(240,240,245,0.7)";
    ctx.fillRect(ix + 1, iy - 3, 1, 2);
  } else {
    ctx.fillStyle = "#c9553e";
    ctx.fillRect(ix, iy, 5, 4);
    ctx.fillStyle = "#e8b84a";
    ctx.fillRect(ix + 1, iy + 1, 3, 2);
  }
}

function shade(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (value >> 16) - 36);
  const g = Math.max(0, ((value >> 8) & 0xff) - 36);
  const b = Math.max(0, (value & 0xff) - 36);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
