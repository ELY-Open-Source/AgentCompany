import { test, expect, type Page } from "@playwright/test";
import { faqs, items, quests } from "../../lib/content";
import { INK, paletteFor, type DayPart, type Season } from "../../lib/palette";
import { platformDownloads, SOURCE_URL } from "../../lib/release-links";

const assetIds = new Set(platformDownloads.flatMap((platform) => platform.assets.map((asset) => asset.id)));
const STATS_PATH = "/api/download-stats";

// Pages Functions do not run under the static server, so the stats fetch is the only expected failure.
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (new URL(message.location().url || "about:blank", "http://x").pathname === STATS_PATH) return;
    errors.push(`console: ${message.text()} @ ${message.location().url}`);
  });
  return errors;
}

function skyVar(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink-sky-0").trim());
}

// --ink-* are registered <color> properties, so the computed value comes back as rgb().
async function expectedSky(page: Page, part: DayPart): Promise<string> {
  const season = (await page.locator("html").getAttribute("data-season")) as Season;
  const hex = paletteFor(part, season)[INK.sky0]!;
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

async function pixelStats(base64Png: string) {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64Png}`)).blob());
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const colours = new Set<number>();
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    sum += luma;
    sumSq += luma * luma;
    colours.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
  }
  const n = data.length / 4;
  return { variance: sumSq / n - (sum / n) ** 2, colours: colours.size };
}

test.describe("page structure", () => {
  test("has exactly one h1 and the skip link focuses main", async ({ page }) => {
    await page.goto("/?time=day");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText("AgentCompany");

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  for (const width of [360, 768, 1440]) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/?time=day");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return { scroll: root.scrollWidth, client: root.clientWidth };
      });
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    });
  }

  test("logs no console errors besides the missing stats function, and the XP panel offers a way on", async ({ page }) => {
    const errors = collectErrors(page);
    const stats = page.waitForResponse((response) => new URL(response.url()).pathname === STATS_PATH);
    await page.goto("/?time=day");
    expect((await stats).status()).toBe(404);

    const xp = page.locator("#xp");
    await xp.scrollIntoViewIfNeeded();
    await expect(xp.getByText("Scoreboard offline")).toBeVisible();
    await expect(xp).toContainText("HTTP 404");
    const onward = xp.getByRole("link", { name: "Continue to downloads" });
    await expect(onward).toHaveAttribute("href", "#save-point");
    await onward.click();
    await expect(page).toHaveURL(/#save-point$/);
    await expect(page.locator("#save-point")).toBeInViewport();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
});

test.describe("palette clock", () => {
  test("?time=night sets the night palette on <html>", async ({ page }) => {
    await page.goto("/?time=day");
    await expect.poll(() => skyVar(page)).toBe(await expectedSky(page, "day"));
    await page.goto("/?time=night");
    await expect(page.locator("html")).toHaveAttribute("data-daypart", "night");
    const night = await expectedSky(page, "night");
    expect(night).not.toBe(await expectedSky(page, "day"));
    await expect.poll(() => skyVar(page)).toBe(night);
  });

  test("clicking the HUD cycles through the day parts", async ({ page }) => {
    await page.goto("/?time=dawn");
    const html = page.locator("html");
    const hud = page.getByRole("button", { name: /^Light: / });
    for (const [from, to] of [["dawn", "day"], ["day", "dusk"], ["dusk", "night"], ["night", "dawn"]] as const) {
      await expect(html).toHaveAttribute("data-daypart", from);
      await expect.poll(() => skyVar(page)).toBe(await expectedSky(page, from));
      await hud.click();
      await expect(html).toHaveAttribute("data-daypart", to);
      await expect(hud).toHaveAccessibleName(new RegExp(`^Light: ${to},`));
      await expect.poll(() => skyVar(page)).toBe(await expectedSky(page, to));
    }
  });
});

test.describe("downloads", () => {
  test("every download link is tracked and names a real release asset", async ({ page }) => {
    await page.goto("/?time=day");
    const panel = page.locator("#save-panel");
    const seen = new Set<string>();
    for (const platform of platformDownloads) {
      await page.locator(`#tab-${platform.id}`).click();
      await expect(page.locator(`#tab-${platform.id}`)).toHaveAttribute("aria-selected", "true");
      const links = panel.getByRole("link", { name: /^Download/ });
      await expect(links).toHaveCount(platform.assets.length);
      for (const href of await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))) {
        const match = /^\/api\/download\?asset=([a-z0-9-]+)$/.exec(href ?? "");
        expect(match, `download href ${href}`).not.toBeNull();
        expect(assetIds.has(match![1]!), `unknown asset ${match![1]}`).toBe(true);
        seen.add(match![1]!);
      }
    }
    expect([...seen].sort()).toEqual([...assetIds].sort());

    const everyDownloadHref = await page
      .locator('a[href*="download?"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    for (const href of everyDownloadHref) {
      const id = /^\/api\/download\?asset=([a-z0-9-]+)$/.exec(href)?.[1];
      expect(id && assetIds.has(id), `download href ${href}`).toBe(true);
    }
  });

  test("platform tabs switch the asset list (macOS 4, Windows 1, Linux 2), arrows included", async ({ page }) => {
    await page.goto("/?time=day");
    const rows = page.locator("#save-panel li");
    const expected = { macos: 4, windows: 1, linux: 2 } as const;
    for (const id of ["windows", "linux", "macos"] as const) {
      await page.locator(`#tab-${id}`).click();
      await expect(rows).toHaveCount(expected[id]);
      await expect(page.locator("#save-panel")).toHaveAttribute("aria-labelledby", `tab-${id}`);
    }
    await page.locator("#tab-macos").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tab-windows")).toBeFocused();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("AgentCompany-1.5.1-x64.exe");
  });

  test("the hero CTA recommends the detected build and the source link points at Gitea", async ({ page }) => {
    await page.goto("/?time=day");
    const hero = page.locator("#top");
    const cta = hero.getByRole("link", { name: /^Download for / });
    await expect(cta).toHaveAttribute("href", /^\/api\/download\?asset=[a-z0-9-]+$/);
    const id = new URL((await cta.getAttribute("href"))!, "http://x").searchParams.get("asset")!;
    expect(assetIds.has(id)).toBe(true);

    const source = hero.getByRole("link", { name: "View source on Gitea" });
    await expect(source).toHaveAttribute("href", "https://git.zacharyzhang.com/ZacharyZhang-NY/AgentCompany");
    expect(SOURCE_URL).toBe("https://git.zacharyzhang.com/ZacharyZhang-NY/AgentCompany");
  });
});

test.describe("keyboard paths", () => {
  test("quest map arrow keys move the selection", async ({ page }) => {
    await page.goto("/?time=day");
    const map = page.getByRole("list", { name: "Onboarding steps" });
    const nodes = map.getByRole("button");
    const detail = page.locator("#quests").getByText(quests[1]!.body);

    await nodes.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await expect(nodes.nth(1)).toBeFocused();
    await expect(nodes.nth(1)).toHaveAttribute("aria-current", "step");
    await expect(nodes.nth(0)).not.toHaveAttribute("aria-current", "step");
    await expect(detail).toBeVisible();

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    const last = quests.length - 1;
    await expect(nodes.nth(last)).toBeFocused();
    await expect(page.locator("#quests").getByText(quests[last]!.body)).toBeVisible();
  });

  test("inventory arrow keys change the described item", async ({ page }) => {
    await page.goto("/?time=day");
    const options = page.getByRole("listbox", { name: "Inventory" }).getByRole("option");
    const info = page.locator("#items [aria-live=polite]").first();

    await options.nth(0).focus();
    await expect(info).toContainText(items[0]!.description);
    await page.keyboard.press("ArrowRight");
    await expect(options.nth(1)).toBeFocused();
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(info).toContainText(items[1]!.name);
    await expect(info).toContainText(items[1]!.description);

    await page.keyboard.press("End");
    await expect(info).toContainText(items[items.length - 1]!.description);
    await page.keyboard.press("ArrowLeft");
    await expect(info).toContainText(items[items.length - 2]!.description);
  });

  test("FAQ menu: arrows move the cursor and Enter makes the NPC answer", async ({ page }) => {
    await page.goto("/?time=day");
    const menu = page.getByRole("menu", { name: "Questions" });
    const entries = menu.getByRole("menuitem");
    const npc = page.locator("#faq figure");

    await entries.nth(0).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(entries.nth(2)).toBeFocused();
    await expect(entries.nth(2)).toContainText(faqs[2]!.question);
    await page.keyboard.press("Enter");

    const answer = faqs[2]!.answer[0]!;
    await expect(npc.locator("blockquote p[aria-live=polite]")).toHaveText(answer);
    await expect(npc.locator('blockquote p[aria-hidden="true"]')).toHaveText(answer);
    await expect(npc.locator('blockquote p[aria-hidden="true"] span')).toHaveText("", { timeout: 10_000 });
  });
});

test.describe("motion preferences", () => {
  test("NPC lines type out by default once on screen", async ({ page }) => {
    await page.goto("/?time=day");
    const npc = page.locator("#faq figure");
    const full = faqs[0]!.answer[0]!;
    const ghost = npc.locator('blockquote p[aria-hidden="true"] span');
    await expect(ghost).toHaveText(full);
    await npc.scrollIntoViewIfNeeded();
    await page.waitForFunction((length) => {
      const left = document.querySelector('#faq figure blockquote p[aria-hidden="true"] span')!.textContent!.length;
      return left > 0 && left < length;
    }, full.length);
    await expect(ghost).toHaveText("", { timeout: 10_000 });
  });

  test.describe("with reduced motion", () => {
    test.use({ contextOptions: { reducedMotion: "reduce" } });

    test("NPC text shows fully at once", async ({ page }) => {
      await page.goto("/?time=day");
      const npc = page.locator("#faq figure");
      await expect(npc.locator('blockquote p[aria-hidden="true"]')).toHaveText(faqs[0]!.answer[0]!);
      await expect(npc.locator('blockquote p[aria-hidden="true"] span')).toHaveText("");
    });
  });
});

test.describe("WebGL hero", () => {
  test("renders a non-uniform pixel scene into a canvas", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/?time=dusk");
    const canvas = page.locator("#top canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator('#top [class*="__skyline"]')).toHaveCount(0);

    // Hide everything but the canvas so the hero copy cannot supply the variance.
    const style = "body * { visibility: hidden !important; } #top canvas { visibility: visible !important; }";
    let colours = 0;
    await expect
      .poll(
        async () => {
          const png = (await canvas.screenshot({ style })).toString("base64");
          const stats = await page.evaluate(pixelStats, png);
          colours = stats.colours;
          return stats.variance;
        },
        { timeout: 20_000, message: "hero canvas luma variance" },
      )
      .toBeGreaterThan(100);
    expect(colours).toBeGreaterThanOrEqual(8);
    expect(errors).toEqual([]);
  });

  test("shows the CSS skyline fallback when WebGL is unavailable @no-webgl", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/?time=night");
    const fallback = page.locator('#top [class*="__skyline"]');
    await expect(fallback).toBeVisible();
    expect(await page.locator('#top [class*="__tower"]').count()).toBeGreaterThan(5);
    await expect(page.locator("#top canvas")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
});

test.describe("404", () => {
  test("unknown paths show GAME OVER with a CONTINUE to home", async ({ page }) => {
    const response = await page.goto("/nope");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "GAME OVER" })).toBeVisible();
    await expect(page.getByText("CONTINUE?")).toBeVisible();
    const yes = page.getByRole("menuitem", { name: "YES" });
    const no = page.getByRole("menuitem", { name: /^NO/ });
    await expect(yes).toHaveAttribute("href", "/");
    await expect(no).toHaveAttribute("href", "/");
    await yes.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#top h1")).toContainText("AgentCompany");
  });
});
