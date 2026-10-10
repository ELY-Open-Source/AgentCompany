import { AmbientLight, DirectionalLight, Vector3 } from "three";
import { INK, type DayPart } from "../../lib/palette";
import type { Office } from "./office";

interface Light {
  sun: [number, number, number];
  sunInk: number;
  sunPower: number;
  fill: number;
  lampInk: number;
  lamps: number;
  screens: number;
  glow: number;
}

const LIGHT: Record<DayPart, Light> = {
  dawn: { sun: [-0.6, 0.5, 0.62], sunInk: INK.glow, sunPower: 1.6, fill: 2.0, lampInk: INK.glow, lamps: 0, screens: 0.85, glow: 0 },
  day: { sun: [-0.35, 0.85, 0.4], sunInk: INK.white, sunPower: 1.55, fill: 1.85, lampInk: INK.glow, lamps: 0, screens: 0.75, glow: 0 },
  dusk: { sun: [0.7, 0.45, 0.55], sunInk: INK.glow, sunPower: 1.5, fill: 2.0, lampInk: INK.glow, lamps: 4, screens: 1, glow: 0.8 },
  night: { sun: [-0.3, 0.9, 0.3], sunInk: INK.sun, sunPower: 1.2, fill: 3.2, lampInk: INK.gold, lamps: 8, screens: 1, glow: 1.6 },
};

export function createLights(): { sun: DirectionalLight; sky: AmbientLight } {
  const sun = new DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
  return { sun, sky: new AmbientLight() };
}

/** Points the sun, tints the ambient fill and switches lamps and screens for a day part. */
export function applyLighting(lights: { sun: DirectionalLight; sky: AmbientLight }, office: Office, colours: string[], part: DayPart): void {
  const light = LIGHT[part];
  lights.sun.position.copy(new Vector3(...light.sun).normalize().multiplyScalar(24));
  lights.sun.color.set(colours[light.sunInk]!);
  lights.sun.intensity = light.sunPower;
  lights.sky.color.set(colours[INK.white]!);
  lights.sky.intensity = light.fill;
  for (const lamp of office.lamps) {
    lamp.color.set(colours[light.lampInk]!);
    lamp.intensity = light.lamps;
  }
  for (const glow of office.glows) {
    glow.color.set(colours[INK.screen]!);
    glow.intensity = light.glow;
  }
  office.bulbs.color.set(colours[light.lamps > 0 ? light.lampInk : INK.paper]!);
  for (const screen of office.screens) screen.color.set(colours[INK.screen]!).multiplyScalar(light.screens);
  office.steam.color.set(colours[INK.cloud]!);
}
