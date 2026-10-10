/**
 * Deterministic pixel people. Every agent gets a stable appearance derived
 * from identity; poses are drawn at twice the scene's pixel density by
 * person-art.ts, finished with rim light and a selective outline, and cached.
 */
import { ANCHOR, ART_H, ART_W, personArt, type PersonFrame } from "./person-art";

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
  pants: string;
  shoes: string;
}

export interface PersonPose {
  facing: Facing;
  /** Radians accumulated while walking; 0 means standing still. */
  walkPhase: number;
  /** Typing at a desk. */
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
const PANTS_COLORS = ["#3a3f47", "#2f4a6b", "#6b5a45", "#4a4a52", "#2b2d33"];
const SHOE_COLORS = ["#26292e", "#5a3a26", "#e8e6e0", "#26292e"];

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
    pants: isCeo ? "#22252c" : pick(PANTS_COLORS, hash, 19),
    shoes: isCeo ? "#1b1c20" : pick(SHOE_COLORS, hash, 23),
  };
}

/** The pose frame a moment shows: four walk steps, two typing beats, a blink every few seconds. */
export function frameFor(pose: PersonPose): PersonFrame {
  const turn = 2 * Math.PI;
  const step = pose.walkPhase === 0 ? -1 : Math.floor(((((pose.walkPhase % turn) + turn) % turn) / turn) * 4);
  const blinkEvery = 3200 + (pose.animSeed % 7) * 300;
  return {
    facing: pose.facing,
    step,
    typing: pose.working ? Math.floor(pose.timeMs / 180 + pose.animSeed) % 2 : -1,
    blink: (pose.timeMs + pose.animSeed * 97) % blinkEvery < 120,
    carrying: pose.carrying,
  };
}

/** Most recently drawn pose canvases; the least recent go first past the cap. */
const cache = new Map<string, HTMLCanvasElement>();
const CACHE_CAP = 2048;

function spriteFor(appearance: SpriteAppearance, frame: PersonFrame, isCeo: boolean): HTMLCanvasElement {
  const key = `${JSON.stringify(appearance)}|${isCeo}|${frame.facing}|${frame.step}|${frame.typing}|${frame.blink}|${frame.carrying}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const grid = personArt(appearance, frame, isCeo);
  const canvas = document.createElement("canvas");
  canvas.width = ART_W;
  canvas.height = ART_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("A sprite canvas has no 2D context.");
  ctx.putImageData(new ImageData(grid.data, ART_W, ART_H), 0, 0);
  cache.set(key, canvas);
  if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value!);
  return canvas;
}

/** Draws a person standing at foot-centre (x, y) in scene pixels; the sprite is half its art size there. */
export function drawPerson(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  appearance: SpriteAppearance,
  pose: PersonPose,
  isCeo: boolean,
): void {
  const frame = frameFor(pose);
  const breath = frame.step < 0 && frame.typing < 0 && Math.floor(pose.timeMs / 1100 + pose.animSeed) % 3 === 0 ? -0.5 : 0;
  const ax = Math.round(x * 2) / 2;
  const ay = Math.round(y * 2) / 2;
  ctx.fillStyle = "rgba(24,18,12,0.3)";
  ctx.fillRect(ax - 6, ay - 0.5, 12, 1.5);
  ctx.fillRect(ax - 4, ay + 1, 8, 1);
  ctx.drawImage(spriteFor(appearance, frame, isCeo), ax - ANCHOR.x / 2, ay + breath - ANCHOR.y / 2, ART_W / 2, ART_H / 2);
}
