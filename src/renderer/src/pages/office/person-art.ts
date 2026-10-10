import { finishSprite, mix, PixelGrid, tone } from "./pixel-grid";
import type { Carrying, Facing, SpriteAppearance } from "./sprites";

/** Sprite canvas in art pixels (two per iso pixel); the feet rest on ANCHOR. */
export const ART_W = 40;
export const ART_H = 80;
export const ANCHOR = { x: 20, y: 74 };

/** One drawn pose: walk step 0-3 (-1 standing), typing hands 0/1 (-1 not typing), eyes shut mid-blink. */
export interface PersonFrame {
  facing: Facing;
  step: number;
  typing: number;
  blink: boolean;
  carrying: Carrying;
}

const EYE = "#2a2430";
const WHITE = "#fbfaf6";
const SHIRT_WHITE = "#ecebe6";
const BELT = "#2b2a30";
const BUCKLE = "#c9b27a";
const MOUTH = "#9c4d48";
const BLUSH = "#e88a8a";
const BLAZER = "#37415c";
const BLAZER_CEO = "#262c3d";

export function personArt(look: SpriteAppearance, frame: PersonFrame, isCeo: boolean): PixelGrid {
  const grid = new PixelGrid(ART_W, ART_H);
  const side = frame.facing === "east" || frame.facing === "west";
  const lift = frame.step === 1 || frame.step === 3 ? -1 : 0;
  if (side) drawSide(grid, look, frame, isCeo, lift);
  else drawFrontOrBack(grid, look, frame, isCeo, lift, frame.facing === "south");
  finishSprite(grid);
  return frame.facing === "west" ? grid.mirrored() : grid;
}

function jacketOf(look: SpriteAppearance, isCeo: boolean): string {
  return look.outfit === "blazer" ? (isCeo ? BLAZER_CEO : BLAZER) : look.shirt;
}

function drawFrontOrBack(g: PixelGrid, look: SpriteAppearance, frame: PersonFrame, isCeo: boolean, lift: number, front: boolean): void {
  const leftUp = frame.step === 0 ? 2 : 0;
  const rightUp = frame.step === 2 ? 2 : 0;
  legs(g, look, 12, 53, 7, leftUp, front);
  legs(g, look, 21, 53, 7, rightUp, front);
  g.rect(19, 53, 2, 4, look.pants);
  const y = lift;
  const body = jacketOf(look, isCeo);
  g.rect(11, 33 + y, 18, 18, body);
  g.clear(11, 33 + y);
  g.clear(28, 33 + y);
  g.rect(11, 51 + y, 18, 2, BELT);
  if (front) g.rect(19, 51 + y, 2, 2, BUCKLE);
  const swing = frame.step < 0 ? 0 : frame.step === 0 ? 1 : frame.step === 2 ? -1 : 0;
  if (frame.typing >= 0) typingArms(g, look, body, y, frame.typing);
  else {
    arm(g, look, body, 8, 34 + y + swing);
    arm(g, look, body, 29, 34 + y - swing);
  }
  if (front) frontOutfit(g, look, body, y);
  else backOutfit(g, look, body, y);
  g.rect(17, 31 + y, 6, 2, tone(look.skin, 0.84));
  head(g, look, frame, y, front);
  if (frame.carrying && frame.typing < 0) carried(g, frame.carrying, 31, 44 + y - swing);
}

function legs(g: PixelGrid, look: SpriteAppearance, x: number, top: number, w: number, up: number, front: boolean): void {
  g.rect(x, top, w, 17 - up, look.pants);
  g.rect(x, top + 6, 1, 8 - up, tone(look.pants, 0.85));
  const shoeY = 70 - up;
  g.rect(x - 1, shoeY, w + 1, 3, look.shoes);
  g.rect(x - 1, shoeY + 3, w + 1, 1, tone(look.shoes, 0.6));
  if (front) g.rect(x, shoeY, 2, 1, tone(look.shoes, 1.4));
}

function arm(g: PixelGrid, look: SpriteAppearance, body: string, x: number, top: number): void {
  const sleeve = look.outfit === "tee" ? 6 : 14;
  g.rect(x, top, 3, sleeve, body);
  g.rect(x, top + sleeve, 3, 15 - sleeve, look.skin);
  if (look.outfit === "blazer") g.rect(x, top + 13, 3, 1, SHIRT_WHITE);
  if (look.outfit === "hoodie") g.rect(x, top + 13, 3, 1, tone(body, 0.78));
  g.rect(x, top + 15, 3, 3, look.skin);
  g.px(x + 1, top + 17, tone(look.skin, 0.82));
}

function typingArms(g: PixelGrid, look: SpriteAppearance, body: string, y: number, beat: number): void {
  for (const [x, inward, offset] of [[8, 1, beat], [29, -1, 1 - beat]] as const) {
    g.rect(x, 34 + y, 3, 9, body);
    g.rect(x + inward * 2, 41 + y - offset, 3, 4, body);
    g.rect(x + inward * 3, 44 + y - offset, 3, 2, look.skin);
  }
}

function frontOutfit(g: PixelGrid, look: SpriteAppearance, body: string, y: number): void {
  if (look.outfit === "tee") {
    g.rect(18, 33 + y, 4, 1, look.skin);
    g.rect(19, 34 + y, 2, 1, look.skin);
    g.rect(22, 38 + y, 3, 2, look.accent);
    g.rect(11, 50 + y, 18, 1, tone(body, 0.85));
    return;
  }
  if (look.outfit === "hoodie") {
    g.rect(13, 33 + y, 14, 2, tone(body, 0.78));
    g.rect(17, 35 + y, 1, 5, WHITE);
    g.rect(22, 35 + y, 1, 5, WHITE);
    g.rect(14, 43 + y, 12, 6, tone(body, 0.88));
    g.rect(14, 43 + y, 12, 1, tone(body, 0.74));
    return;
  }
  for (let row = 0; row < 12; row++) {
    const half = Math.max(1, 3 - Math.floor(row / 3));
    g.rect(20 - half, 33 + y + row, half * 2, 1, SHIRT_WHITE);
    g.px(19 - half, 33 + y + row, tone(body, 0.72));
    g.px(20 + half, 33 + y + row, tone(body, 0.72));
  }
  g.rect(19, 34 + y, 2, 1, tone(look.accent, 0.8));
  g.rect(19, 35 + y, 2, 9, look.accent);
  g.px(19, 44 + y, tone(look.accent, 0.8));
  g.px(21, 47 + y, "#d8d0b8");
  g.px(21, 49 + y, "#d8d0b8");
  g.rect(24, 37 + y, 2, 1, look.accent);
}

function backOutfit(g: PixelGrid, look: SpriteAppearance, body: string, y: number): void {
  if (look.outfit === "hoodie") g.rect(14, 33 + y, 12, 5, tone(body, 0.82));
  if (look.outfit === "blazer") g.rect(19, 44 + y, 1, 7, tone(body, 0.7));
  if (look.outfit === "tee") g.rect(11, 50 + y, 18, 1, tone(body, 0.85));
}

function head(g: PixelGrid, look: SpriteAppearance, frame: PersonFrame, y: number, front: boolean): void {
  const top = 12 + y;
  g.rect(11, top, 18, 19, look.skin);
  for (const [x, dy] of [[11, 0], [12, 0], [11, 1], [28, 0], [27, 0], [28, 1], [11, 18], [28, 18]] as const) g.clear(x, top + dy);
  g.rect(10, top + 8, 1, 4, tone(look.skin, 0.9));
  g.rect(29, top + 8, 1, 4, tone(look.skin, 0.9));
  if (front) {
    face(g, look, frame.blink, top);
    frontHair(g, look, top);
  } else backHair(g, look, top);
}

function face(g: PixelGrid, look: SpriteAppearance, blink: boolean, top: number): void {
  const brow = tone(look.hair, 0.8);
  g.rect(13, top + 6, 3, 1, brow);
  g.rect(24, top + 6, 3, 1, brow);
  if (look.glasses) {
    const lens = mix(look.skin, "#9fd0f0", 0.35);
    for (const x of [13, 23]) {
      g.rect(x, top + 7, 4, 5, "#1c1c22");
      g.rect(x + 1, top + 8, 2, 3, lens);
    }
    g.rect(17, top + 8, 6, 1, "#1c1c22");
  }
  for (const x of [14, 24]) {
    if (blink) g.rect(x, top + 10, 2, 1, EYE);
    else {
      g.rect(x, top + 8, 2, 3, EYE);
      g.px(x + 1, top + 8, WHITE);
    }
  }
  g.px(20, top + 12, tone(look.skin, 0.8));
  g.rect(18, top + 15, 4, 1, MOUTH);
  g.px(17, top + 14, mix(look.skin, MOUTH, 0.5));
  g.px(22, top + 14, mix(look.skin, MOUTH, 0.5));
  const blush = mix(look.skin, BLUSH, 0.45);
  g.rect(13, top + 13, 2, 1, blush);
  g.rect(25, top + 13, 2, 1, blush);
}

function cap(g: PixelGrid, look: SpriteAppearance, top: number, rows: number): void {
  g.rect(12, top - 2, 16, 1, look.hair);
  g.rect(11, top - 1, 18, rows + 1, look.hair);
  g.rect(14, top - 1, 4, 1, tone(look.hair, 1.4));
}

function frontHair(g: PixelGrid, look: SpriteAppearance, top: number): void {
  const hair = look.hair;
  switch (look.hairStyle) {
    case "bald":
      g.rect(15, top + 1, 3, 1, tone(look.skin, 1.12));
      return;
    case "buzz":
      g.rect(12, top - 1, 16, 3, hair);
      g.rect(11, top + 2, 1, 4, hair);
      g.rect(28, top + 2, 1, 4, hair);
      return;
    case "short":
      cap(g, look, top, 4);
      g.rect(12, top + 4, 7, 1, hair);
      g.rect(11, top + 4, 2, 5, hair);
      g.rect(27, top + 4, 2, 5, hair);
      return;
    case "bob":
      cap(g, look, top, 5);
      g.rect(9, top + 2, 4, 14, hair);
      g.rect(27, top + 2, 4, 14, hair);
      g.rect(13, top + 5, 14, 1, tone(hair, 0.85));
      return;
    case "long":
      cap(g, look, top, 4);
      g.rect(9, top + 2, 4, 25, hair);
      g.rect(27, top + 2, 4, 25, hair);
      g.rect(13, top + 4, 8, 1, hair);
      g.rect(10, top + 8, 1, 14, tone(hair, 1.25));
      return;
    case "ponytail":
      cap(g, look, top, 4);
      g.rect(21, top + 4, 6, 1, hair);
      g.rect(29, top + 2, 3, 12, hair);
      g.rect(29, top + 2, 3, 1, tone(look.accent, 0.9));
      return;
    case "curly":
      cap(g, look, top - 1, 5);
      for (let x = 10; x <= 29; x += 2) g.rect(x, top - 4 + (x % 4 === 0 ? 0 : 1), 2, 2, hair);
      for (let row = 2; row < 12; row += 2) {
        g.rect(9 + (row % 4 === 0 ? 0 : 1), top + row, 3, 2, hair);
        g.rect(28 - (row % 4 === 0 ? 0 : 1), top + row, 3, 2, hair);
      }
      g.rect(13, top + 4, 14, 1, tone(hair, 0.85));
      return;
  }
}

function backHair(g: PixelGrid, look: SpriteAppearance, top: number): void {
  const hair = look.hair;
  if (look.hairStyle === "bald") return;
  const depth = { buzz: 10, short: 14, bob: 18, long: 18, ponytail: 15, curly: 15 }[look.hairStyle];
  g.rect(12, top - 2, 16, 1, hair);
  g.rect(11, top - 1, 18, depth, hair);
  g.rect(14, top, 5, 1, tone(hair, 1.4));
  if (look.hairStyle === "long") g.rect(10, top + 14, 20, 12, hair);
  if (look.hairStyle === "bob") g.rect(10, top + 12, 20, 4, hair);
  if (look.hairStyle === "ponytail") {
    g.rect(18, top + 13, 4, 1, look.accent);
    g.rect(18, top + 14, 4, 11, hair);
    g.rect(19, top + 25, 2, 2, hair);
  }
  if (look.hairStyle === "curly") for (let x = 11; x <= 28; x += 3) g.rect(x, top + 14, 2, 2, hair);
}

function drawSide(g: PixelGrid, look: SpriteAppearance, frame: PersonFrame, isCeo: boolean, lift: number): void {
  const stride = frame.step === 0 ? 3 : frame.step === 2 ? -3 : 0;
  sideLeg(g, look, 15 - stride, 0.82);
  sideLeg(g, look, 20 + stride, 1);
  const y = lift;
  const body = jacketOf(look, isCeo);
  g.rect(13, 33 + y, 14, 18, body);
  g.clear(13, 33 + y);
  g.clear(26, 33 + y);
  g.rect(13, 51 + y, 14, 2, BELT);
  if (look.outfit === "hoodie") g.rect(13, 33 + y, 5, 6, tone(body, 0.8));
  if (look.outfit === "blazer") {
    g.rect(24, 33 + y, 3, 9, SHIRT_WHITE);
    g.rect(25, 35 + y, 2, 8, look.accent);
  }
  if (look.outfit === "tee") g.rect(22, 38 + y, 3, 2, look.accent);
  const swing = frame.typing >= 0 ? 4 : -stride;
  arm(g, look, body, 18 + Math.round(swing / 2), 34 + y);
  g.rect(17, 31 + y, 5, 2, tone(look.skin, 0.84));
  sideHead(g, look, frame.blink, 12 + y);
  if (frame.carrying && frame.typing < 0) carried(g, frame.carrying, 22 + Math.round(swing / 2), 46 + y);
}

function sideLeg(g: PixelGrid, look: SpriteAppearance, x: number, shade: number): void {
  g.rect(x, 53, 5, 17, tone(look.pants, shade));
  g.rect(x, 70, 7, 3, tone(look.shoes, shade));
  g.rect(x, 73, 7, 1, tone(look.shoes, 0.6 * shade));
}

function sideHead(g: PixelGrid, look: SpriteAppearance, blink: boolean, top: number): void {
  g.rect(12, top, 16, 19, look.skin);
  for (const [x, dy] of [[12, 0], [13, 0], [12, 1], [27, 0], [26, 0], [27, 1], [12, 18], [27, 18]] as const) g.clear(x, top + dy);
  g.rect(28, top + 10, 1, 3, look.skin);
  g.rect(17, top + 8, 2, 4, tone(look.skin, 0.86));
  g.rect(21, top + 6, 4, 1, tone(look.hair, 0.8));
  if (blink) g.rect(22, top + 10, 2, 1, EYE);
  else {
    g.rect(22, top + 8, 2, 3, EYE);
    g.px(23, top + 8, WHITE);
  }
  if (look.glasses) {
    g.rect(21, top + 7, 4, 1, "#1c1c22");
    g.rect(21, top + 11, 4, 1, "#1c1c22");
    g.rect(16, top + 8, 5, 1, "#1c1c22");
  }
  g.rect(24, top + 15, 3, 1, MOUTH);
  g.rect(24, top + 13, 2, 1, mix(look.skin, BLUSH, 0.45));
  if (look.hairStyle === "bald") return;
  const hair = look.hair;
  const back = { buzz: 8, short: 12, bob: 16, long: 16, ponytail: 12, curly: 14 }[look.hairStyle];
  g.rect(13, top - 2, 13, 1, hair);
  g.rect(12, top - 1, 15, look.hairStyle === "buzz" ? 3 : 5, hair);
  g.rect(11, top, 7, back, hair);
  g.rect(15, top - 1, 5, 1, tone(hair, 1.4));
  if (look.hairStyle === "long") g.rect(10, top + 12, 8, 14, hair);
  if (look.hairStyle === "bob") g.rect(25, top + 4, 2, 2, hair);
  if (look.hairStyle === "ponytail") g.rect(8, top + 4, 4, 12, hair);
  if (look.hairStyle === "curly") for (let row = 0; row < 14; row += 3) g.rect(10, top + row, 2, 2, hair);
}

function carried(g: PixelGrid, item: NonNullable<Carrying>, x: number, y: number): void {
  if (item === "coffee") {
    g.rect(x, y, 4, 5, WHITE);
    g.rect(x, y, 4, 1, "#6b4a2f");
    g.px(x + 4, y + 2, WHITE);
    return;
  }
  g.rect(x, y + 1, 5, 4, "#c9553e");
  g.rect(x + 1, y + 2, 3, 2, "#e8b84a");
}
