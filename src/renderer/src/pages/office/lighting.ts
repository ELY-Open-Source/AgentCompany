import type { OfficeState } from "./agent-state";
import type { Camera, FloorPlan, Rect, Vec } from "./office-types";
import type { DayPart } from "../../shared/palette-clock";
import { BACK_WALL_H, toIso, type IsoFrame } from "./iso";
import { WALL } from "./floor-plan";

interface Light {
  at: Vec;
  z: number;
  /** Reach in iso pixels. */
  radius: number;
  rgb: string;
  strength: number;
}

const AMBIENT: Record<DayPart, string> = { day: "rgb(236,232,224)", dawn: "rgb(214,190,196)", dusk: "rgb(222,184,150)", night: "rgb(58,68,112)" };
const LAMPS_ON: Record<DayPart, number> = { day: 0.18, dawn: 0.6, dusk: 0.8, night: 1 };
const SCREEN_RGB: Record<OfficeState, string> = { running: "88,230,170", queued: "160,170,200", cooldown: "240,170,70", blocked: "240,80,80", idle: "110,130,170" };
const WARM = "255,206,140";
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const LEVELS = 12;

/** Every lamp and screen in the office: monitors glow in their agent's state colour, rooms and the open floor have warm lamps. */
export function sceneLights(plan: FloorPlan, screens: Map<Rect, OfficeState>): Light[] {
  const lights: Light[] = [];
  for (const [desk, state] of screens) {
    lights.push({ at: { x: desk.x + desk.w / 2, y: desk.y + 14 }, z: 20, radius: 26, rgb: SCREEN_RGB[state], strength: state === "idle" ? 0.35 : 0.8 });
  }
  for (const desk of plan.desks) lights.push({ at: { x: desk.bounds.x + desk.bounds.w / 2, y: desk.bounds.y + 60 }, z: 0, radius: 58, rgb: WARM, strength: 0.7 });
  for (const room of plan.rooms) {
    const b = room.bounds;
    const rgb = room.kind === "restroom" ? "205,228,255" : WARM;
    lights.push({ at: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, z: 0, radius: Math.max(b.w, b.h) * 0.42, rgb, strength: 0.85 });
  }
  for (let x = 120; x < plan.world.w; x += 220) lights.push({ at: { x, y: 320 }, z: 0, radius: 64, rgb: WARM, strength: 0.75 });
  return lights;
}

/** Sunlit floor under each window, longer and slanted toward evening or morning; none at night. */
export function sunPatches(windows: Rect[], clock: Date): Vec[][] {
  const hour = clock.getHours() + clock.getMinutes() / 60;
  if (hour < 6.5 || hour > 18.5) return [];
  const reach = 1.1 + Math.abs(hour - 12.5) * 0.35;
  const slant = (12.5 - hour) * 0.18;
  return windows.map((glass) => {
    const low = (BACK_WALL_H - glass.y - glass.h) * reach;
    const high = (BACK_WALL_H - glass.y) * reach;
    return [
      { x: glass.x + slant * low, y: WALL + low },
      { x: glass.x + glass.w + slant * low, y: WALL + low },
      { x: glass.x + glass.w + slant * high, y: WALL + high },
      { x: glass.x + slant * high, y: WALL + high },
    ];
  });
}

/** Bands a light map into a few levels with a 4×4 ordered dither, so light falls off in pixels, not gradients. */
export function ditherLevels(data: Uint8ClampedArray, width: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const pixel = i / 4;
    const threshold = BAYER[((Math.floor(pixel / width) & 3) << 2) | (pixel % width & 3)]! / 16 - 0.5;
    for (let c = 0; c < 3; c++) {
      const level = Math.round((data[i + c]! / 255) * LEVELS + threshold);
      data[i + c] = (Math.max(0, Math.min(LEVELS, level)) / LEVELS) * 255;
    }
  }
}

interface LightingInput {
  frame: IsoFrame;
  camera: Camera;
  /** Scene pixels per iso pixel. */
  art: number;
  dayPart: DayPart;
  lights: Light[];
  patches: Vec[][];
  timeMs: number;
}

/** Multiplies the finished scene by a light map drawn at iso resolution: ambient for the hour, lamps and screens added, sun through the windows. */
export function applyLighting(scene: CanvasRenderingContext2D, map: HTMLCanvasElement, input: LightingInput): void {
  const w = Math.ceil(scene.canvas.width / input.art);
  const h = Math.ceil(scene.canvas.height / input.art);
  if (map.width !== w || map.height !== h) {
    map.width = w;
    map.height = h;
  }
  const ctx = map.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("The light map canvas has no 2D context.");
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = AMBIENT[input.dayPart];
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
  const lamps = LAMPS_ON[input.dayPart];
  const view = (p: Vec, z = 0) => {
    const iso = toIso(input.frame, p, z);
    return { x: iso.x - input.camera.x, y: iso.y - input.camera.y };
  };
  for (const light of input.lights) {
    const at = view(light.at, light.z);
    if (at.x < -light.radius || at.y < -light.radius || at.x > w + light.radius || at.y > h + light.radius) continue;
    const glow = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, light.radius);
    glow.addColorStop(0, `rgba(${light.rgb},${0.55 * light.strength * lamps})`);
    glow.addColorStop(1, `rgba(${light.rgb},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(at.x - light.radius, at.y - light.radius, light.radius * 2, light.radius * 2);
  }
  ctx.fillStyle = input.dayPart === "day" ? "rgba(255,240,205,0.16)" : "rgba(255,196,140,0.12)";
  for (const patch of input.patches) {
    ctx.beginPath();
    patch.map((p) => view(p)).forEach((p, index) => (index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }
  const image = ctx.getImageData(0, 0, w, h);
  ditherLevels(image.data, w);
  ctx.putImageData(image, 0, 0);
  scene.save();
  scene.setTransform(input.art, 0, 0, input.art, 0, 0);
  scene.imageSmoothingEnabled = false;
  scene.globalCompositeOperation = "multiply";
  scene.drawImage(map, 0, 0);
  scene.globalCompositeOperation = "source-over";
  drawDust(scene, input, view);
  scene.restore();
}

/** Dust motes drifting up through the sunlit patches. */
function drawDust(scene: CanvasRenderingContext2D, input: LightingInput, view: (p: Vec, z?: number) => Vec): void {
  scene.fillStyle = "rgba(255,246,220,0.75)";
  input.patches.forEach((patch, index) => {
    const centre = { x: (patch[0]!.x + patch[2]!.x) / 2, y: (patch[0]!.y + patch[2]!.y) / 2 };
    for (let mote = 0; mote < 5; mote++) {
      const seed = index * 7 + mote * 13;
      const rise = ((input.timeMs / 90 + seed * 11) % 40);
      const drift = Math.sin(input.timeMs / 1400 + seed) * 6;
      const at = view({ x: centre.x + ((seed * 37) % 50) - 25 + drift, y: centre.y + ((seed * 17) % 30) - 15 }, rise);
      scene.fillRect(Math.round(at.x * 2) / 2, Math.round(at.y * 2) / 2, 0.5, 0.5);
    }
  });
}
