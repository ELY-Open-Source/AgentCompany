import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";
import { closeApp, onboard } from "./onboard";

test("text uses the bundled pixel font, and the palette follows the day part, season and clock theme", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-pixel-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-pixel-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  try {
    const page = await app.firstWindow();
    await onboard(page, "Pixel Co");
    // The font file itself loaded, not a fallback.
    expect(await page.evaluate(async () => {
      await document.fonts.load('12px "Fusion Pixel"', "像素 Pixel");
      return [...document.fonts].some((face) => face.family.replace(/"/g, "") === "Fusion Pixel" && face.status === "loaded");
    })).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Fusion Pixel/);

    const expected = await page.evaluate(() => {
      const now = new Date();
      const hour = now.getHours();
      const month = now.getMonth();
      const part = hour >= 5 && hour < 8 ? "dawn" : hour >= 8 && hour < 17 ? "day" : hour >= 17 && hour < 20 ? "dusk" : "night";
      const season = month >= 2 && month <= 4 ? "spring" : month >= 5 && month <= 7 ? "summer" : month >= 8 && month <= 10 ? "autumn" : "winter";
      return { part, season };
    });
    const root = page.locator("html");
    await expect(root).toHaveAttribute("data-daypart", expected.part);
    await expect(root).toHaveAttribute("data-season", expected.season);

    // The ground carries the dither; the chosen nav row blinks the pixel menu arrow, other rows show none; dialogs sit in the 9-slice frame.
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".main")!).backgroundImage)).toContain("data:image/svg+xml");
    expect(await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".nav > .nav-item")];
      const active = rows.find((row) => row.matches(".active, [aria-current]"))!;
      const idle = rows.find((row) => !row.matches(".active, [aria-current]"))!;
      return [getComputedStyle(active, "::before").animationName, getComputedStyle(idle, "::before").animationName, getComputedStyle(idle, "::before").visibility];
    })).toEqual(["px-blink", "none", "hidden"]);
    // Every icon on screen is a pixel glyph on the font's grid; no stroked vector icons remain.
    expect(await page.evaluate(() => ({
      stroked: [...document.querySelectorAll("svg")].filter((svg) => !svg.closest("canvas") && svg.getAttribute("stroke") && svg.getAttribute("stroke") !== "none").length,
      size: getComputedStyle(document.querySelector("svg.pixel-icon")!).width === getComputedStyle(document.body).fontSize,
    }))).toEqual({ stroked: 0, size: true });
    expect(await page.evaluate(() => document.querySelectorAll(".nav > .nav-item").length)).toBe(await page.evaluate(() => document.querySelectorAll(".nav > .nav-item svg.pixel-icon").length));
    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((node) => {
      const style = getComputedStyle(node.closest(".modal") ?? node.querySelector(".modal")!);
      return [style.borderImageSource.startsWith('url("data:image/svg+xml'), style.borderImageSlice, style.borderTopWidth];
    })).toEqual([true, "3 fill", "6px"]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Progress is an XP bar announced as a value; hints are spoken by the guide in a bubble.
    await page.getByRole("button", { name: "Home" }).click();
    await expect(page.getByRole("progressbar", { name: "Goal progress" })).toHaveAttribute("aria-valuenow", "0");
    // On the roster the only agent holds the largest budget, and the bar says it compares budgets, not spend.
    await page.getByRole("button", { name: "Team", exact: true }).click();
    await expect(page.getByRole("progressbar", { name: "Budget compared with the largest agent budget" })).toHaveAttribute("aria-valuenow", "100");
    await page.getByRole("button", { name: "Work", exact: true }).click();
    const hint = page.getByRole("note").filter({ hasText: "Only a task runs" });
    await expect(hint.locator(".hint-speaker svg.pixel-icon")).toHaveCount(1);
    // Tabs are raised pixel tabs; fields are sunken pixel boxes.
    const views = page.getByRole("radiogroup", { name: "View" });
    expect(await views.locator("[aria-checked=true]").evaluate((tab) => getComputedStyle(tab).borderBottomColor === getComputedStyle(tab).backgroundColor)).toBe(true);

    // Shell: the chosen page is an inverse block, rules are 2px, and search opens in the framed panel whose rows take the menu arrow.
    await expect.poll(() => page.evaluate(() => {
      const active = getComputedStyle(document.querySelector(".nav > .nav-item.active")!);
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--btn-primary-bg").trim();
      const probe = document.createElement("div");
      probe.style.color = accent;
      document.body.append(probe);
      const accentRgb = getComputedStyle(probe).color;
      probe.remove();
      return [active.backgroundColor === accentRgb, getComputedStyle(document.querySelector(".topbar")!).borderBottomWidth, getComputedStyle(document.querySelector(".sidebar")!).borderRightWidth];
    })).toEqual([true, "2px", "2px"]);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const search = page.getByRole("dialog", { name: "Search" });
    expect(await search.locator("form").evaluate((panel) => getComputedStyle(panel).borderImageSource.startsWith('url("data:image/svg+xml'))).toBe(true);
    await search.getByLabel("Search query").fill("CEO");
    const row = search.locator(".search-row").first();
    await row.hover();
    expect(await row.evaluate((node) => getComputedStyle(node, "::before").animationName)).toBe("px-blink");
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);

    await page.getByRole("button", { name: "Settings" }).click();
    expect(await page.getByRole("combobox", { name: "Theme" }).evaluate((field) => [getComputedStyle(field).borderTopWidth, getComputedStyle(field).borderRadius])).toEqual(["2px", "0px"]);
    await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
    await expect(root).toHaveAttribute("data-theme", "dark");
    await page.getByRole("combobox", { name: "Theme" }).selectOption({ label: "Follow the clock" });
    await expect(root).toHaveAttribute("data-theme", expected.part === "night" ? "dark" : "light");

    // Each font pixel covers a whole number of screen pixels at this display's scale.
    expect(await page.evaluate(() => {
      const fontPx = parseFloat(getComputedStyle(document.body).fontSize) * window.devicePixelRatio;
      return Math.abs(fontPx - Math.round(fontPx)) < 1e-6 && Math.round(fontPx) % 12 === 0;
    })).toBe(true);

  } finally {
    await closeApp(app);
  }
});
