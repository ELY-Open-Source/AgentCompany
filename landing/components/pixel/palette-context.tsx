"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { dayPartAt, paletteCssVars, paletteFor, seasonAt, type DayPart, type Season } from "../../lib/palette";
import { applyPalette, overrideFrom } from "./palette-boot";

type Override = { part: DayPart | null; season: Season | null };

export type PaletteClockValue = {
  dayPart: DayPart;
  season: Season;
  colours: string[];
  setOverride: (part: DayPart | null, season: Season | null) => void;
};

const PaletteClockContext = createContext<PaletteClockValue | null>(null);
const TICK_MS = 60_000;

export function PaletteClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState<Date | null>(null);
  const [override, setOverrideState] = useState<Override>({ part: null, season: null });

  useEffect(() => {
    setOverrideState(overrideFrom(window.location.search));
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const dayPart = override.part ?? (now ? dayPartAt(now) : "day");
  const season = override.season ?? (now ? seasonAt(now) : "summer");
  const colours = useMemo(() => paletteFor(dayPart, season), [dayPart, season]);

  useEffect(() => {
    if (now) applyPalette(paletteCssVars(colours), dayPart, season);
  }, [now, colours, dayPart, season]);

  const setOverride = useCallback((part: DayPart | null, nextSeason: Season | null) => {
    setOverrideState({ part, season: nextSeason });
  }, []);

  const value = useMemo(() => ({ dayPart, season, colours, setOverride }), [dayPart, season, colours, setOverride]);
  return <PaletteClockContext.Provider value={value}>{children}</PaletteClockContext.Provider>;
}

export function usePaletteClock(): PaletteClockValue {
  const value = useContext(PaletteClockContext);
  if (!value) throw new Error("usePaletteClock must be used inside <PaletteClock>");
  return value;
}
