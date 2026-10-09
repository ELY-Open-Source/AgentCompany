import { useEffect, useState } from "react";
import type { UiTheme } from "../../../shared/snapshot-domain";

export type DayPart = "dawn" | "day" | "dusk" | "night";
export type Season = "spring" | "summer" | "autumn" | "winter";

/** Local-hour bands the palette rotates through. */
export function dayPart(now: Date): DayPart {
  const hour = now.getHours();
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

/** Meteorological seasons by month, northern hemisphere. */
export function season(now: Date): Season {
  const month = now.getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

export function resolveTheme(theme: UiTheme, prefersDark: boolean, now: Date): "light" | "dark" {
  if (theme === "system") return prefersDark ? "dark" : "light";
  if (theme === "clock") return dayPart(now) === "night" ? "dark" : "light";
  return theme;
}

const TICK_MS = 60_000;

/** Applies the theme, day part and season to the document root, rechecked every minute and whenever the OS scheme changes. */
export function usePaletteClock(theme: UiTheme): void {
  const [now, setNow] = useState(() => new Date());
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => setPrefersDark(media.matches);
    media.addEventListener("change", onScheme);
    return () => {
      window.clearInterval(timer);
      media.removeEventListener("change", onScheme);
    };
  }, []);
  const resolved = resolveTheme(theme, prefersDark, now);
  const part = dayPart(now);
  const time = season(now);
  useEffect(() => {
    Object.assign(document.documentElement.dataset, { theme: resolved, daypart: part, season: time });
  }, [resolved, part, time]);
}
