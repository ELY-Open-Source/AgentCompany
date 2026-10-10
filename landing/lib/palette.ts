/** One 32-colour palette; the scene keeps its indices while day part and season swap the colours. */
export type DayPart = "dawn" | "day" | "dusk" | "night";
export type Season = "spring" | "summer" | "autumn" | "winter";

export const PALETTE_SIZE = 32;

/** Named indices every surface draws with; art never uses raw colours. */
export const INK = {
  void: 0, shadow: 1, ink: 2, inkSoft: 3, stone: 4, stoneLight: 5, paper: 6, white: 7,
  sky0: 8, sky1: 9, sky2: 10, sky3: 11, sun: 12, glow: 13, cloud: 14, star: 15,
  wood: 16, woodDark: 17, brick: 18, rug: 19, leaf0: 20, leaf1: 21, leaf2: 22, bloom: 23,
  accent: 24, accentDark: 25, gold: 26, mint: 27, sea: 28, berry: 29, skin: 30, screen: 31,
} as const;
export type InkName = keyof typeof INK;

const DAY: string[] = [
  "#0b0a12", "#1d1b2b", "#2f2c40", "#4a4660", "#6d6884", "#9a95ad", "#e9e2cf", "#fbf7ec",
  "#3f7fd1", "#68a2e6", "#9cc6f2", "#d4e8fa", "#ffe08a", "#fff2c2", "#f4f7fb", "#ffffff",
  "#a8693c", "#6e3f23", "#b4533f", "#5d6ea8", "#2f6b3a", "#4f9a4a", "#8cc95f", "#f2a3c0",
  "#e0663d", "#9c3b22", "#f2b632", "#5fd3a8", "#2a8fa8", "#c4466f", "#f1c79a", "#7ef0c2",
];

/** How a day part shifts each index: sky and light are replaced, everything else is tinted. */
const DAY_PART_SKY: Record<DayPart, string[]> = {
  dawn: ["#5b4a7a", "#c77a8e", "#f2a98a", "#fbd9b0", "#ffb36b", "#ffd9a8", "#f7d6d8", "#fff4e6"],
  day: DAY.slice(8, 16),
  dusk: ["#2d2350", "#7a3d6e", "#d0625a", "#f4a259", "#ff8c42", "#ffc078", "#e9b0a0", "#ffe7c7"],
  night: ["#05060f", "#0d1330", "#1b2650", "#2c3b70", "#e6e9ff", "#9fb2ff", "#3a4470", "#fff8d6"],
};
const DAY_PART_TINT: Record<DayPart, { mix: string; amount: number }> = {
  dawn: { mix: "#f3b5a8", amount: 0.18 },
  day: { mix: "#ffffff", amount: 0 },
  dusk: { mix: "#f08a4b", amount: 0.22 },
  night: { mix: "#1a2350", amount: 0.55 },
};
const SEASON_LEAVES: Record<Season, [string, string, string, string]> = {
  spring: ["#3f7a3c", "#5fae52", "#9ed46c", "#f6a8c8"],
  summer: ["#235c2e", "#3f8f3f", "#78c050", "#ffd35c"],
  autumn: ["#7a3a1c", "#c2622a", "#e8a33d", "#d9483b"],
  winter: ["#4c6670", "#8aa6ad", "#dfeaee", "#ffffff"],
};

export function dayPartAt(date: Date): DayPart {
  const hour = date.getHours();
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

export function seasonAt(date: Date): Season {
  const month = date.getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

/** The 32 colours for a moment; index 31 (screens) and the accents stay lit at night. */
export function paletteFor(part: DayPart, season: Season): string[] {
  const tint = DAY_PART_TINT[part];
  const lit = new Set<number>([INK.screen, INK.accent, INK.gold, INK.mint, INK.glow, INK.star]);
  const colours = DAY.map((colour, index) => (lit.has(index) ? colour : mix(colour, tint.mix, tint.amount)));
  DAY_PART_SKY[part].forEach((colour, offset) => (colours[INK.sky0 + offset] = colour));
  SEASON_LEAVES[season].forEach((colour, offset) => (colours[INK.leaf0 + offset] = colour));
  return colours;
}

/** CSS custom properties --p0..--p31 plus named aliases (--ink-accent, ...). */
export function paletteCssVars(colours: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  colours.forEach((colour, index) => (vars[`--p${index}`] = colour));
  for (const [name, index] of Object.entries(INK)) vars[`--ink-${kebab(name)}`] = colours[index]!;
  return vars;
}

function kebab(name: string): string {
  return name.replace(/[A-Z0-9]/g, (char) => `-${char.toLowerCase()}`);
}

function mix(a: string, b: string, amount: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - amount) + ((pb >> shift) & 255) * amount);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, "0")}`;
}
