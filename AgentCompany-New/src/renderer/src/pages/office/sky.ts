import type { Rect } from "./office-types";

/**
 * The world outside the office windows, driven by real local time: night
 * with stars and a moon, a warm sunrise, blue day, and an orange sunset,
 * over a city skyline whose windows light up after dark. All color math is
 * pure so the phase timeline is unit-testable.
 */

export type SkyPhaseKey = "night" | "dawn" | "day" | "dusk";

export interface SkyScene {
  phase: SkyPhaseKey;
  top: Rgb;
  bottom: Rgb;
  /** Sun position in unit space, null when below the horizon. */
  sun: { x: number; elevation: number } | null;
  /** Moon position in unit space, null during daylight. */
  moon: { x: number; elevation: number } | null;
  /** 0 (invisible) to 1 (full night sky). */
  starIntensity: number;
  /** City windows glow from dusk through dawn. */
  cityLights: boolean;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface SkyPalette {
  top: Rgb;
  bottom: Rgb;
}

const NIGHT: SkyPalette = { top: rgb(11, 16, 38), bottom: rgb(30, 41, 73) };
const DAWN: SkyPalette = { top: rgb(84, 100, 150), bottom: rgb(242, 160, 107) };
const DAY: SkyPalette = { top: rgb(96, 166, 222), bottom: rgb(199, 228, 245) };
const DUSK: SkyPalette = { top: rgb(74, 66, 110), bottom: rgb(232, 118, 79) };

/** (hour, palette) anchors across a day; linearly interpolated between. */
const TIMELINE: Array<[number, SkyPalette]> = [
  [0, NIGHT],
  [5.5, NIGHT],
  [6.5, DAWN],
  [7.5, DAY],
  [17.5, DAY],
  [18.5, DUSK],
  [19.5, NIGHT],
  [24, NIGHT],
];

const SUNRISE_H = 6;
const SUNSET_H = 19;

export function phaseAt(date: Date): SkyPhaseKey {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour < 5.5 || hour >= 19.5) return "night";
  if (hour < 7.5) return "dawn";
  if (hour < 17.5) return "day";
  return "dusk";
}

export function skyScene(date: Date): SkyScene {
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const palette = paletteAt(hour);
  const dayProgress = (hour - SUNRISE_H) / (SUNSET_H - SUNRISE_H);
  const sunUp = dayProgress > 0 && dayProgress < 1;
  const nightProgress = hour >= SUNSET_H ? (hour - SUNSET_H) / (24 - SUNSET_H + SUNRISE_H) : (hour + 24 - SUNSET_H) / (24 - SUNSET_H + SUNRISE_H);
  const starIntensity = clamp01(hour < 12 ? (5.75 - hour) / 0.75 : (hour - 19.25) / 0.75);
  return {
    phase: phaseAt(date),
    top: palette.top,
    bottom: palette.bottom,
    sun: sunUp ? { x: dayProgress, elevation: Math.sin(dayProgress * Math.PI) } : null,
    moon: sunUp ? null : { x: nightProgress, elevation: Math.sin(nightProgress * Math.PI) * 0.9 + 0.05 },
    starIntensity,
    cityLights: !sunUp || Math.sin(dayProgress * Math.PI) < 0.12,
  };
}

function paletteAt(hour: number): SkyPalette {
  for (let i = 0; i + 1 < TIMELINE.length; i++) {
    const [fromHour, fromPalette] = TIMELINE[i];
    const [toHour, toPalette] = TIMELINE[i + 1];
    if (hour >= fromHour && hour <= toHour) {
      const t = toHour === fromHour ? 0 : (hour - fromHour) / (toHour - fromHour);
      return {
        top: lerpRgb(fromPalette.top, toPalette.top, t),
        bottom: lerpRgb(fromPalette.bottom, toPalette.bottom, t),
      };
    }
  }
  return NIGHT;
}

export function drawWindowSky(ctx: CanvasRenderingContext2D, glass: Rect, scene: SkyScene, seed: number): void {
  const gradient = ctx.createLinearGradient(0, glass.y, 0, glass.y + glass.h);
  gradient.addColorStop(0, css(scene.top));
  gradient.addColorStop(1, css(scene.bottom));
  ctx.fillStyle = gradient;
  ctx.fillRect(glass.x, glass.y, glass.w, glass.h);

  if (scene.starIntensity > 0) {
    ctx.fillStyle = `rgba(238,240,255,${0.85 * scene.starIntensity})`;
    for (let i = 0; i < Math.floor(glass.w / 5); i++) {
      const sx = glass.x + ((seed * 61 + i * 137) % glass.w);
      const sy = glass.y + ((seed * 43 + i * 89) % Math.max(1, glass.h - 14));
      ctx.fillRect(sx, sy, 1, 1);
    }
  }

  if (scene.sun) {
    const sx = glass.x + 4 + scene.sun.x * (glass.w - 8);
    const sy = glass.y + 4 + (1 - scene.sun.elevation) * (glass.h - 16);
    ctx.fillStyle = "rgba(255,214,120,0.35)";
    ctx.fillRect(sx - 4, sy - 4, 9, 9);
    ctx.fillStyle = "#ffd66e";
    ctx.fillRect(sx - 2, sy - 2, 5, 5);
  } else if (scene.moon) {
    const mx = glass.x + 4 + scene.moon.x * (glass.w - 8);
    const my = glass.y + 4 + (1 - scene.moon.elevation) * (glass.h - 16);
    ctx.fillStyle = "#e8ecf5";
    ctx.fillRect(mx - 2, my - 2, 5, 5);
    ctx.fillStyle = "#c3cad9";
    ctx.fillRect(mx, my - 1, 2, 2);
  }

  drawSkyline(ctx, glass, scene, seed);
}

function drawSkyline(ctx: CanvasRenderingContext2D, glass: Rect, scene: SkyScene, seed: number): void {
  const silhouette = scene.phase === "day" ? rgb(122, 148, 178) : lerpRgb(rgb(26, 30, 48), scene.bottom, 0.25);
  const baseline = glass.y + glass.h;
  let x = glass.x;
  let column = 0;
  while (x < glass.x + glass.w) {
    const key = seed * 31 + column * 97;
    const width = 8 + (key % 8);
    const height = 8 + ((key >> 2) % Math.max(4, glass.h - 18));
    const w = Math.min(width, glass.x + glass.w - x);
    ctx.fillStyle = css(silhouette);
    ctx.fillRect(x, baseline - height, w, height);
    if (scene.cityLights) {
      ctx.fillStyle = "rgba(255,224,130,0.9)";
      for (let wx = 1; wx + 2 < w; wx += 3) {
        for (let wy = 2; wy + 2 < height; wy += 4) {
          if (((key >> 3) + wx * 7 + wy * 13) % 4 === 0) ctx.fillRect(x + wx, baseline - height + wy, 1, 2);
        }
      }
    }
    x += w;
    column += 1;
  }
}

function rgb(r: number, g: number, b: number): Rgb {
  return { r, g, b };
}

function lerpRgb(from: Rgb, to: Rgb, t: number): Rgb {
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  };
}

function css(color: Rgb): string {
  return `rgb(${color.r},${color.g},${color.b})`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
