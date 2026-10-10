import type { ReactNode } from "react";
import { dayPartAt, paletteFor, seasonAt, type DayPart, type Season } from "../../lib/palette";
import { applyPalette, overrideFrom } from "./palette-boot";
import { PaletteClockProvider } from "./palette-context";

const PARTS: DayPart[] = ["dawn", "day", "dusk", "night"];
const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
const TABLE = Object.fromEntries(
  PARTS.flatMap((part) => SEASONS.map((season) => [`${part}-${season}`, paletteFor(part, season)])),
);

/** Runs before first paint so night visitors never see a flash of the day palette; also snaps --px to whole device pixels. */
const BOOT = `(function(){var t=${JSON.stringify(TABLE)},d=new Date(),o=(${overrideFrom})(location.search),p=o.part||(${dayPartAt})(d),s=o.season||(${seasonAt})(d),v={};t[p+"-"+s].forEach(function(c,i){v["--p"+i]=c});(${applyPalette})(v,p,s);var r=window.devicePixelRatio||1,e=document.documentElement;e.style.setProperty("--px",String(Math.max(1,Math.round(r))/r));e.dataset.js=""})()`;

/** Rotates the 32-colour palette with the visitor's clock (or ?time=&season=) and shares it via usePaletteClock. */
export function PaletteClock({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      <PaletteClockProvider>{children}</PaletteClockProvider>
    </>
  );
}
