import { describe, expect, test } from "vitest";
import { cardPositionFor, CARD_W } from "../../src/renderer/src/pages/office/agent-card-position";

describe("agent detail card placement", () => {
  test("sits to the right of the sprite, vertically centered on it", () => {
    const position = cardPositionFor({ x: 400, y: 300 }, { x: 0, y: 0 }, 1200, 800, 170);
    expect(position.left).toBe(418);
    expect(position.top).toBe(300 - 16 - 85);
  });

  test("flips to the left when the right edge would leave the viewport", () => {
    const position = cardPositionFor({ x: 1100, y: 300 }, { x: 0, y: 0 }, 1200, 800, 170);
    expect(position.left).toBe(1100 - CARD_W - 18);
    expect(position.left + CARD_W).toBeLessThanOrEqual(1200 - 8);
  });

  test("clamps fully on screen near every edge", () => {
    for (const agent of [{ x: 5, y: 5 }, { x: 5, y: 795 }, { x: 1195, y: 5 }, { x: 1195, y: 795 }]) {
      const position = cardPositionFor(agent, { x: 0, y: 0 }, 1200, 800, 170);
      expect(position.left).toBeGreaterThanOrEqual(8);
      expect(position.left + CARD_W).toBeLessThanOrEqual(1192);
      expect(position.top).toBeGreaterThanOrEqual(8);
      expect(position.top + 170).toBeLessThanOrEqual(792);
    }
  });

  test("accounts for the camera offset", () => {
    const onScreen = cardPositionFor({ x: 700, y: 500 }, { x: 300, y: 200 }, 1200, 800, 170);
    const noCamera = cardPositionFor({ x: 400, y: 300 }, { x: 0, y: 0 }, 1200, 800, 170);
    expect(onScreen).toEqual(noCamera);
  });
});
