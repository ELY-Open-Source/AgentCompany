"use client";

import type { CSSProperties } from "react";
import type { DayPart, Season } from "../../lib/palette";
import { Icon, type IconName } from "./icon";
import { usePaletteClock } from "./palette-context";
import styles from "./pixel.module.css";

const PARTS: DayPart[] = ["dawn", "day", "dusk", "night"];
const PART_ICON: Record<DayPart, IconName> = { dawn: "sunrise", day: "sun", dusk: "sunset", night: "moon" };
const SEASON_ICON: Record<Season, IconName> = { spring: "blossom", summer: "icecream", autumn: "maple", winter: "snowflake" };

/** The HUD: today's light and season plus the live palette; clicking skips to the next part of the day. */
export function Hud() {
  const { dayPart, season, colours, setOverride } = usePaletteClock();
  const next = PARTS[(PARTS.indexOf(dayPart) + 1) % PARTS.length]!;
  return (
    <button
      type="button"
      className={`${styles.frame} ${styles.hud}`}
      onClick={() => setOverride(next, season)}
      aria-label={`Light: ${dayPart}, ${season}. Switch to ${next}`}
    >
      <span className={styles.hudGlyphs}>
        <Icon name={PART_ICON[dayPart]} size={2} />
        <Icon name={SEASON_ICON[season]} size={2} />
      </span>
      <span className={styles.hudText}>
        <span>{dayPart.toUpperCase()}</span>
        <span className={styles.swatches} aria-hidden="true">
          {colours.map((_, index) => (
            <i key={index} style={{ "--swatch": `var(--p${index})` } as CSSProperties} />
          ))}
        </span>
      </span>
    </button>
  );
}
