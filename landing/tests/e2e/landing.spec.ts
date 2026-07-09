import { test, expect, type Page } from "@playwright/test";

// The download counter endpoint is a Cloudflare Pages Function, absent from the
// static export served in tests; mock it so the client fetch resolves.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/download-stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ downloads: 12345 }),
    }),
  );
});

/** Step through the page so reveals fire and lazy images load. */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const dwell = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const step = Math.round(window.innerHeight * 0.7);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await dwell(150);
    }
    window.scrollTo(0, 0);
    await dwell(200);
  });
}

test("renders the hero and every core section", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Autonomous AI Company");
  for (const id of ["features", "how-it-works", "faq", "download"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await scrollThrough(page);
  await expect(page.getByRole("heading", { name: "Launch your company now." })).toBeVisible();
});

test("download links use the tracked endpoint and never expose R2 URLs", async ({ page }) => {
  await page.goto("/");
  await scrollThrough(page);

  // Every advertised platform asset routes through the tracked endpoint
  // (currently Windows only - macOS returns once its build ships to R2).
  const tracked = page.locator('#download a[href^="/api/download?asset="]');
  expect(await tracked.count()).toBeGreaterThanOrEqual(1);

  // Real release URLs must stay behind the server-side redirect.
  expect(await page.locator('a[href*="r2.dev"]').count()).toBe(0);

  await expect(page.getByText(/12,345 downloads/)).toBeVisible();
});

test("theme toggle flips light and dark", async ({ page }) => {
  await page.goto("/");
  const toggle = page.locator('button[aria-label*="mode"]:visible').first();
  const wasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await toggle.click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(!wasDark);
});

test("all images load without breaking", async ({ page }) => {
  await page.goto("/");
  await scrollThrough(page);
  const broken = await page.evaluate(() =>
    [...document.querySelectorAll("img")]
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.currentSrc || img.src),
  );
  expect(broken).toEqual([]);
});

test("produces no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await scrollThrough(page);
  expect(errors).toEqual([]);
});

test("desktop navigation exposes the section links", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "desktop layout only");
  await page.goto("/");
  for (const href of ["#features", "#how-it-works", "#faq"]) {
    await expect(page.locator(`nav a[href="${href}"]:visible`)).toBeVisible();
  }
});

test("mobile navigation reveals the menu on tap", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "mobile layout only");
  await page.goto("/");
  const links = page.locator('#mobile-nav a[href="#features"]');
  await expect(links).toBeHidden();
  await page.getByRole("button", { name: /open navigation menu/i }).click();
  await expect(links).toBeVisible();
});
