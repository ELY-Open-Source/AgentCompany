import { execFileSync } from "node:child_process";

/**
 * Playwright globalSetup: build the Electron app from source before E2E tests.
 * Uses execFileSync and enables shell mode on Windows so the pnpm shim resolves correctly.
 */
export default function globalSetup() {
  execFileSync("pnpm", ["electron-vite", "build"], {
    stdio: "inherit",
    cwd: process.cwd(),
    timeout: 120_000,
    shell: process.platform === "win32",
  });
}
