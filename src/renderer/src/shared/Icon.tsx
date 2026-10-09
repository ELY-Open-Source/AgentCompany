import { PIXEL_ICONS } from "./pixel-icons";

export type IconName = keyof typeof PIXEL_ICONS;

/** Each row's lit runs as one path, so an icon is a single crisp shape. */
function bitmapPath(bitmap: string): string {
  return bitmap.split(" ").flatMap((row, y) =>
    [...row.matchAll(/#+/g)].map((run) => `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`),
  ).join("");
}

const PATHS = Object.fromEntries(Object.entries(PIXEL_ICONS).map(([name, bitmap]) => [name, bitmapPath(bitmap)])) as Record<IconName, string>;

/** A 12-pixel icon drawn on the same whole-screen-pixel grid as the pixel font. */
export function Icon({ name, color = "currentColor" }: { name: IconName; color?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className="pixel-icon"
      fill={color}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
