import { execFileSync } from "node:child_process";

/**
 * Playwright globalSetup: build the Electron app from source before E2E tests.
 * Uses execFileSync (no shell) for safety and deterministic builds.
 */
export default function globalSetup() {
  execFileSync("pnpm", ["electron-vite", "build"], {
    stdio: "inherit",
    cwd: process.cwd(),
    timeout: 120_000,
  });
}
