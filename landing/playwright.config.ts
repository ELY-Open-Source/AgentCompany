import { defineConfig, devices } from "@playwright/test";

const PORT = 4319;
const baseURL = `http://127.0.0.1:${PORT}`;

// Optional override for the Chromium binary (useful when the standard
// `playwright install` revision is unavailable locally); CI uses the bundled
// browser and leaves this unset.
const executablePath = process.env.PW_CHROME || undefined;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    launchOptions,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: `node tests/e2e/serve.mjs out ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
