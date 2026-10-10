import { defineConfig, devices } from "@playwright/test";

const PORT = 4319;
const baseURL = `http://127.0.0.1:${PORT}`;

// Optional override for the Chromium binary (useful when the standard
// `playwright install` revision is unavailable locally); CI uses the bundled
// browser and leaves this unset.
const executablePath = process.env.PW_CHROME || undefined;
const swiftshader = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      grepInvert: /@no-webgl/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: { executablePath, args: swiftshader },
      },
    },
    {
      name: "no-webgl",
      grep: /@no-webgl/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: { executablePath, args: ["--disable-webgl", "--disable-webgl2"] },
      },
    },
  ],
  // `npm run test:e2e` builds the static export first; this only serves `out/` (with 404.html for unknown paths).
  webServer: {
    command: `node tests/e2e/serve.mjs out ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
