import type { SocialPlatform } from "../../../../shared/domain";

const PLATFORM_VISUAL: Record<SocialPlatform, { background: string; label: string; font: string }> = {
  x: { background: "#0a0a0b", label: "𝕏", font: "system-ui" },
  linkedin: { background: "#0a66c2", label: "in", font: "inherit" },
  youtube: { background: "#ff0000", label: "▶", font: "system-ui" },
  instagram: { background: "#e1306c", label: "◎", font: "system-ui" },
};

export function PlatformIcon({ platform, size = 16 }: { platform: SocialPlatform; size?: number }) {
  const visual = PLATFORM_VISUAL[platform];
  if (!visual) throw new Error("Platform visual is missing.");
  const box = size + 12;
  return (
    <div
      style={{
        width: box,
        height: box,
        borderRadius: 6,
        background: visual.background,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontSize: size - 3,
        fontWeight: 700,
        flexShrink: 0,
        fontFamily: visual.font,
      }}
    >
      {visual.label}
    </div>
  );
}
