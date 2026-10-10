import type { DayPart, Season } from "../../lib/palette";

/** Self-contained (no outer references) so the boot script can inline it with Function#toString. */
export function overrideFrom(search: string): { part: DayPart | null; season: Season | null } {
  const query = new URLSearchParams(search);
  const part = query.get("time");
  const season = query.get("season");
  return {
    part: part === "dawn" || part === "day" || part === "dusk" || part === "night" ? part : null,
    season: season === "spring" || season === "summer" || season === "autumn" || season === "winter" ? season : null,
  };
}

/** Self-contained for the same reason: writes the palette variables and day-part attributes onto <html>. */
export function applyPalette(vars: Record<string, string>, part: DayPart, season: Season): void {
  const root = document.documentElement;
  for (const name in vars) root.style.setProperty(name, vars[name]!);
  root.dataset.daypart = part;
  root.dataset.season = season;
}
