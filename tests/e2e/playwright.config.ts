import { join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["desktop.smoke.spec.ts"],
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: join(process.cwd(), "build", "test-results"),
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // Build from current source before running e2e tests.
  // Uses globalSetup (not webServer) because electron-vite build is a
  // one-shot build command, not a long-running server process.
  globalSetup: "./e2e-global-setup.ts",
});
