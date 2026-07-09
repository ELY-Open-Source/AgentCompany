import type { Camera, Vec } from "./office-types";

export const CARD_W = 264;
export const CARD_FALLBACK_H = 170;
const GAP = 18;
const MARGIN = 8;
/** Vertical center of a drawn sprite relative to its anchor point. */
const SPRITE_CENTER_Y = -16;

/**
 * Screen position for the detail card so it sits beside the clicked agent:
 * to the right of the sprite, flipping to the left when the right edge would
 * leave the viewport, and always clamped fully on screen. Pure, so tests can
 * assert placement with the same math the page uses.
 */
export function cardPositionFor(
  agent: Vec,
  camera: Camera,
  viewW: number,
  viewH: number,
  cardH: number = CARD_FALLBACK_H,
): { left: number; top: number } {
  const screenX = agent.x - camera.x;
  const screenY = agent.y - camera.y + SPRITE_CENTER_Y;
  let left = screenX + GAP;
  if (left + CARD_W > viewW - MARGIN) left = screenX - CARD_W - GAP;
  left = clamp(left, MARGIN, Math.max(MARGIN, viewW - CARD_W - MARGIN));
  const top = clamp(screenY - cardH / 2, MARGIN, Math.max(MARGIN, viewH - cardH - MARGIN));
  return { left, top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
