import type { CSSProperties } from "react";
import { PIXEL_ICONS } from "../../lib/pixel-icons";
import styles from "./pixel.module.css";

export type IconName = keyof typeof PIXEL_ICONS;

/** Each row's lit runs become one path, so an icon is a single crisp shape. */
function bitmapPath(bitmap: string): string {
  return bitmap.split(" ").flatMap((row, y) =>
    [...row.matchAll(/#+/g)].map((run) => `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`),
  ).join("");
}

const PATHS = Object.fromEntries(
  Object.entries(PIXEL_ICONS).map(([name, bitmap]) => [name, bitmapPath(bitmap)]),
) as Record<IconName, string>;

/** A hand-placed 12×12 icon at a whole-pixel scale; labelled icons are images, unlabelled ones are decoration. */
export function Icon({ name, size = 1, label }: { name: IconName; size?: 1 | 2 | 3 | 4; label?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={styles.icon}
      style={{ "--icon-scale": size } as CSSProperties}
      fill="currentColor"
      shapeRendering="crispEdges"
      focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
