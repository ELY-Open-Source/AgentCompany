// Draws the 8-bit Open Graph card at 240×126 and writes it ×5 as public/images/og.png.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 240;
const H = 126;
const SCALE = 5;

const PAL = [
  "#0f0f1b", "#1b1b3a", "#2a2a5e", "#3c3c86", "#565aa8", "#fcfcfc", "#f8d878", "#f0a030",
  "#a8e4fc", "#58d854", "#d82800",
].map((hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)));
const [VOID, NIGHT, DUSK, HAZE, ROOF, WHITE, LIGHT, GOLD, ICE, LEAF, RED] = PAL.keys();

const px = new Uint8Array(W * H);
const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = c; };
const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c); };

const FONT = {
  A: "01110 10001 10001 11111 10001 10001 10001", H: "10001 10001 10001 11111 10001 10001 10001",
  C: "01111 10000 10000 10000 10000 10000 01111", D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 11110 10000 10000 10000 11111", G: "01111 10000 10000 10111 10001 10001 01111",
  I: "11111 00100 00100 00100 00100 00100 11111", K: "10001 10010 11100 10010 10001 10001 10001",
  L: "10000 10000 10000 10000 10000 10000 11111", M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 11001 10101 10011 10001 10001 10001", O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 01110 00001 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 10001 01010 01010 00100",
  W: "10001 10001 10001 10101 10101 11011 10001", X: "10001 01010 00100 00100 01010 10001 10001",
  Y: "10001 01010 00100 00100 00100 00100 00100", 1: "00100 01100 00100 00100 00100 00100 01110",
  5: "11111 10000 11110 00001 00001 10001 01110", ".": "00000 00000 00000 00000 00000 00000 00100",
  "-": "00000 00000 00000 11111 00000 00000 00000", "/": "00001 00010 00010 00100 01000 01000 10000",
  "·": "00000 00000 00000 00100 00000 00000 00000", "▶": "10000 11000 11100 11110 11100 11000 10000",
  "!": "00100 00100 00100 00100 00100 00000 00100", " ": "00000 00000 00000 00000 00000 00000 00000",
};

function text(str, x, y, c, s = 1, shadow = -1) {
  [...str].forEach((ch, n) => {
    const rows = FONT[ch];
    if (!rows) throw new Error(`No glyph for "${ch}".`);
    rows.split(" ").forEach((row, j) => [...row].forEach((bit, i) => {
      if (bit !== "1") return;
      const gx = x + n * 6 * s + i * s;
      const gy = y + j * s;
      if (shadow >= 0) rect(gx + s, gy + s, s, s, shadow);
      rect(gx, gy, s, s, c);
    }));
  });
}
const width = (str, s = 1) => str.length * 6 * s - s;

function sprite(art, x, y, map) {
  art.trim().split("\n").forEach((row, j) => [...row.trim()].forEach((ch, i) => { if (ch !== ".") set(x + i, y + j, map[ch]); }));
}

// Night sky in dithered bands, stars and a crescent moon.
const bands = [NIGHT, NIGHT, DUSK, DUSK, HAZE];
for (let y = 0; y < 92; y++) {
  const f = (y / 92) * (bands.length - 1);
  const lo = Math.floor(f);
  for (let x = 0; x < W; x++) set(x, y, f - lo > ((x + y * 2) % 4) / 4 + 0.12 ? bands[lo + 1] : bands[lo]);
}
let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let n = 0; n < 70; n++) set(Math.floor(rand() * W), Math.floor(rand() * 60), rand() > 0.85 ? LIGHT : WHITE);
for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) {
  if (x * x + y * y <= 81 && (x - 4) ** 2 + (y - 3) ** 2 > 64) set(206 + x, 18 + y, LIGHT);
}

// Skyline with lit windows.
for (let x = 0, n = 0; x < W; n++) {
  const w = 10 + Math.floor(rand() * 14);
  const h = x < 150 ? 8 + Math.floor(rand() * 12) : 18 + Math.floor(rand() * 26);
  rect(x, 104 - h, w, h, n % 2 ? VOID : NIGHT);
  for (let wy = 104 - h + 3; wy < 101; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) if (rand() > 0.55) set(wx, wy, rand() > 0.2 ? LIGHT : GOLD);
  x += w;
}
rect(0, 104, W, 22, VOID);

// The tower and the CEO on its roof.
rect(160, 58, 34, 46, NIGHT);
rect(158, 56, 38, 3, ROOF);
for (let y = 62; y < 102; y += 5) for (let x = 163; x < 192; x += 5) rect(x, y, 3, 3, (x + y) % 3 ? LIGHT : GOLD);
sprite(`
..G.G.G..
..GGGGG..
..SSSSS..
..KKSKK..
..SSSSS..
.WBBRBBW.
.SBBRBBS.
..BBBBB..
..BB.BB..
..KK.KK..
`, 172, 44, { G: GOLD, S: LIGHT, K: VOID, W: WHITE, B: DUSK, R: RED });

// Speech bubble from the CEO.
rect(150, 26, 47, 12, WHITE);
for (let i = 0; i < 4; i++) rect(174 + i, 38 + i, 4 - i, 1, WHITE);
text("HIRING!", 153, 28, VOID);

// Logotype, tagline and the dialog box.
text("AGENT", 10, 12, GOLD, 3, VOID);
text("COMPANY", 10, 38, WHITE, 3, VOID);
text("RUN AN AUTONOMOUS AI", 11, 66, ICE, 1, VOID);
text("COMPANY ON YOUR DESKTOP.", 11, 76, ICE, 1, VOID);

rect(6, 98, 228, 24, VOID);
rect(7, 99, 226, 22, WHITE);
rect(8, 100, 224, 20, NIGHT);
text("V1.5.1 · MACOS · WINDOWS · LINUX", 12, 103, WHITE);
text("▶", 12, 112, GOLD);
text("AGENT-COMPANY.DEV", 20, 112, LIGHT);
const free = "NO ACCOUNT";
text(free, 228 - width(free), 112, LEAF);

// PNG encoder: ×SCALE nearest-neighbour, RGB, no filter.
const rowLen = W * SCALE * 3 + 1;
const raw = Buffer.alloc(rowLen * H * SCALE);
for (let y = 0; y < H * SCALE; y++) {
  raw[y * rowLen] = 0;
  for (let x = 0; x < W * SCALE; x++) {
    const [r, g, b] = PAL[px[Math.floor(y / SCALE) * W + Math.floor(x / SCALE)]];
    raw.set([r, g, b], y * rowLen + 1 + x * 3);
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W * SCALE, 0);
ihdr.writeUInt32BE(H * SCALE, 4);
ihdr.set([8, 2, 0, 0, 0], 8);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(new URL("../public/images/og.png", import.meta.url), png);
console.log(`og.png ${W * SCALE}×${H * SCALE}, ${png.length} bytes`);
