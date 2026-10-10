import styles from "./title-screen.module.css";

const GLYPHS: Record<string, string> = {
  A: ".###. #...# #...# ##### #...# #...# #...#",
  G: ".###. #...# #.... #.### #...# #...# .###.",
  E: "##### #.... #.... ####. #.... #.... #####",
  N: "#...# ##..# #.#.# #..## #...# #...# #...#",
  T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
  C: ".###. #...# #.... #.... #.... #...# .###.",
  O: ".###. #...# #...# #...# #...# #...# .###.",
  M: "#...# ##.## #.#.# #.#.# #...# #...# #...#",
  P: "####. #...# #...# ####. #.... #.... #....",
  Y: "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
};

const BLOCK = 0.84;

function glyphPath(letter: string, offsetX: number, offsetY: number): string {
  return GLYPHS[letter]!.split(" ")
    .flatMap((row, y) =>
      [...row].map((cell, x) => (cell === "#" ? `M${offsetX + x} ${offsetY + y}h${BLOCK}v${BLOCK}h-${BLOCK}z` : "")),
    )
    .join("");
}

function Word({ text, tone, start }: { text: string; tone: "accent" | "paper"; start: number }) {
  const width = text.length * 6 - 1 + 1;
  return (
    <svg className={styles.word} data-tone={tone} viewBox={`-0.4 -0.4 ${width} 8`} shapeRendering="crispEdges">
      {[...text].map((letter, index) => (
        <g key={index} className={styles.letter} style={{ animationDelay: `${(start + index) * 70}ms` }}>
          <path className={styles.blockShadow} d={glyphPath(letter, index * 6 + 0.6, 0.6)} />
          <path className={styles.blockOutline} d={glyphPath(letter, index * 6, 0)} />
          <path className={styles.block} d={glyphPath(letter, index * 6, 0)} />
        </g>
      ))}
    </svg>
  );
}

/** The AGENTCOMPANY wordmark, laid brick by brick like a title screen. */
export function Logotype() {
  return (
    <span className={styles.logotype} aria-hidden="true">
      <Word text="AGENT" tone="accent" start={0} />
      <Word text="COMPANY" tone="paper" start={5} />
    </span>
  );
}
