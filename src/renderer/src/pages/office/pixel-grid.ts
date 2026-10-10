/** An RGBA pixel buffer drawn without anti-aliasing, so procedural art stays exact. */
export class PixelGrid {
  readonly data: Uint8ClampedArray<ArrayBuffer>;

  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    const [r, g, b] = rgb(color);
    for (let py = Math.max(0, y); py < Math.min(this.h, y + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(this.w, x + w); px++) this.set(px, py, r, g, b, 255);
    }
  }

  px(x: number, y: number, color: string): void {
    this.rect(x, y, 1, 1, color);
  }

  clear(x: number, y: number): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[(y * this.w + x) * 4 + 3] = 0;
  }

  alpha(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.data[(y * this.w + x) * 4 + 3]!;
  }

  mirrored(): PixelGrid {
    const out = new PixelGrid(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const from = (y * this.w + x) * 4;
        out.data.set(this.data.subarray(from, from + 4), (y * this.w + (this.w - 1 - x)) * 4);
      }
    }
    return out;
  }

  private set(x: number, y: number, r: number, g: number, b: number, a: number): void {
    const at = (y * this.w + x) * 4;
    this.data[at] = r;
    this.data[at + 1] = g;
    this.data[at + 2] = b;
    this.data[at + 3] = a;
  }
}

const NEIGHBOURS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

/** Light from the top left: rim-lit upper-left edges, shaded lower-right edges, then a selective outline in a dark tone of the colour it borders. */
export function finishSprite(grid: PixelGrid): void {
  const source = grid.data.slice();
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < grid.w && y < grid.h && source[(y * grid.w + x) * 4 + 3]! > 0;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const at = (y * grid.w + x) * 4;
      if (opaque(x, y)) {
        const factor = !opaque(x - 1, y) || !opaque(x, y - 1) ? 1.14 : !opaque(x + 1, y) || !opaque(x, y + 1) ? 0.84 : 1;
        for (let c = 0; c < 3; c++) grid.data[at + c] = source[at + c]! * factor;
        continue;
      }
      for (const [dx, dy] of NEIGHBOURS) {
        if (!opaque(x + dx, y + dy)) continue;
        const from = ((y + dy) * grid.w + x + dx) * 4;
        for (let c = 0; c < 3; c++) grid.data[at + c] = source[from + c]! * 0.32;
        grid.data[at + 3] = 255;
        break;
      }
    }
  }
}

/** Mixes two colours; `amount` 0 keeps the first. */
export function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const channel = (from: number, to: number) => Math.round(from + (to - from) * amount);
  return hex(channel(ar, br), channel(ag, bg), channel(ab, bb));
}

/** Scales a colour's channels; below 1 darkens. */
export function tone(color: string, factor: number): string {
  const [r, g, b] = rgb(color);
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value * factor)));
  return hex(channel(r), channel(g), channel(b));
}

function rgb(color: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Sprite colours are #rrggbb, not "${color}".`);
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function hex(r: number, g: number, b: number): string {
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
