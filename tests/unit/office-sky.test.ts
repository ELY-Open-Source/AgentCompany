import { describe, expect, test } from "vitest";
import { phaseAt, skyScene } from "../../src/renderer/src/pages/office/sky";

function at(hours: number, minutes: number): Date {
  return new Date(2026, 6, 6, hours, minutes, 0);
}

describe("office window sky", () => {
  test("maps local time to the four phases", () => {
    expect(phaseAt(at(3, 0))).toBe("night");
    expect(phaseAt(at(6, 30))).toBe("dawn");
    expect(phaseAt(at(12, 0))).toBe("day");
    expect(phaseAt(at(18, 30))).toBe("dusk");
    expect(phaseAt(at(22, 0))).toBe("night");
  });

  test("the sun crosses the sky through the day and hands over to the moon", () => {
    const morning = skyScene(at(8, 0));
    const noon = skyScene(at(13, 0));
    const evening = skyScene(at(18, 0));
    const night = skyScene(at(23, 0));
    expect(morning.sun).not.toBeNull();
    expect(noon.sun!.elevation).toBeGreaterThan(morning.sun!.elevation);
    expect(evening.sun!.x).toBeGreaterThan(morning.sun!.x);
    expect(morning.moon).toBeNull();
    expect(night.sun).toBeNull();
    expect(night.moon).not.toBeNull();
  });

  test("stars and city lights belong to the night, not midday", () => {
    const night = skyScene(at(1, 30));
    const noon = skyScene(at(13, 0));
    expect(night.starIntensity).toBe(1);
    expect(night.cityLights).toBe(true);
    expect(noon.starIntensity).toBe(0);
    expect(noon.cityLights).toBe(false);
  });

  test("dawn blends smoothly instead of snapping palettes", () => {
    const early = skyScene(at(5, 45));
    const later = skyScene(at(6, 15));
    expect(early.top).not.toEqual(later.top);
    const delta = Math.abs(early.bottom.r - later.bottom.r);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(120);
  });

  test("sunrise and sunset windows glow with city lights while the sun is low", () => {
    const sunrise = skyScene(at(6, 10));
    expect(sunrise.sun).not.toBeNull();
    expect(sunrise.cityLights).toBe(true);
  });
});
