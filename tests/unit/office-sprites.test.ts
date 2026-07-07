import { describe, expect, test } from "vitest";
import { appearanceFor } from "../../src/renderer/src/pages/office/sprites";

describe("office sprite appearances", () => {
  test("identity is deterministic", () => {
    const first = appearanceFor("agent-42", false);
    const second = appearanceFor("agent-42", false);
    expect(second).toEqual(first);
  });

  test("a team of agents does not look like clones", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `agent-${i}-${i * 7919}`);
    const looks = ids.map((id) => appearanceFor(id, false));
    const skins = new Set(looks.map((look) => look.skin));
    const hairStyles = new Set(looks.map((look) => look.hairStyle));
    const hairColors = new Set(looks.map((look) => look.hair));
    const shirts = new Set(looks.map((look) => look.shirt));
    expect(skins.size).toBeGreaterThanOrEqual(4);
    expect(hairStyles.size).toBeGreaterThanOrEqual(5);
    expect(hairColors.size).toBeGreaterThanOrEqual(5);
    expect(shirts.size).toBeGreaterThanOrEqual(6);
    expect(looks.some((look) => look.glasses)).toBe(true);
    expect(looks.some((look) => !look.glasses)).toBe(true);
  });

  test("the CEO always dresses the part", () => {
    const ceo = appearanceFor("ceo-agent", true);
    expect(ceo.outfit).toBe("blazer");
  });
});
