import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _electron as electron, expect, test } from "@playwright/test";
import { getElectronExecutablePath, getMainEntryPath } from "./launch";

test("first launch onboarding creates a company and opens the desktop shell", async () => {
  const entry = getMainEntryPath();
  expect(existsSync(entry)).toBeTruthy();

  const profileDir = await mkdtemp(join(tmpdir(), "agentcompany-e2e-"));
  const workspaceDir = await mkdtemp(join(tmpdir(), "agentcompany-workspace-"));

  const app = await electron.launch({
    executablePath: getElectronExecutablePath(),
    args: [entry],
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENTCOMPANY_PROFILE_DIR: profileDir,
      AGENTCOMPANY_DISABLE_UPDATES: "true",
      AGENTCOMPANY_DISABLE_SINGLE_INSTANCE: "true",
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByText("AgentCompany Desktop")).toBeVisible();
    await page.getByLabel("Company name").fill("Orbit Foundry");
    await page.getByLabel("Workspace folder").fill(workspaceDir);
    const continueButton = page.getByRole("button", { name: /^Continue$/i });
    if (await continueButton.isEnabled()) {
      await continueButton.click();
      await page.getByLabel("Goal").fill("Launch the company");
      await page.getByRole("button", { name: /Launch Company/i }).click();
      await expect(page.getByRole("heading", { name: /Orbit Foundry is live/i })).toBeVisible();
      await expect(page.getByText("Initial run")).toBeVisible();
      await page.getByRole("button", { name: /Open control center/i }).click();

      await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
      // Company name is rendered in a custom dropdown trigger button in the sidebar.
      await expect(page.locator("aside button", { hasText: "Orbit Foundry" }).first()).toBeVisible();
      const showConsoleButton = page.getByRole("button", { name: /show console/i });
      const hideConsoleButton = page.getByRole("button", { name: /hide console/i });
      if (await hideConsoleButton.isVisible().catch(() => false)) {
        await expect(page.getByText("Console", { exact: true })).toBeVisible();
        await hideConsoleButton.click();
        await expect(page.getByText("Console", { exact: true })).toBeHidden();
      } else {
        await expect(showConsoleButton).toBeVisible();
      }
      await showConsoleButton.click();
      await expect(page.getByText("Console", { exact: true })).toBeVisible();
    } else {
      await expect(page.getByText(/Install, authenticate, and fully validate at least one supported CLI runtime/i)).toBeVisible();
      await expect(page.getByText(/cannot be used for autonomous execution/i).first()).toBeVisible();
    }
  } finally {
    await app.close();
    await rm(profileDir, { recursive: true, force: true });
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

// NOTE: On headless Linux (CI), run via: xvfb-run pnpm test:e2e
// See RESEARCH.md Pitfall 5 for details.
test("platform launch: app opens, window renders, screenshot captured", async () => {
  const entry = getMainEntryPath();
  expect(existsSync(entry)).toBeTruthy();

  const profileDir = await mkdtemp(join(tmpdir(), "agentcompany-launch-"));
  const screenshotDir = join(process.cwd(), "build", "screenshots");
  await mkdir(screenshotDir, { recursive: true });

  const app = await electron.launch({
    executablePath: getElectronExecutablePath(),
    args: [entry],
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENTCOMPANY_PROFILE_DIR: profileDir,
      AGENTCOMPANY_DISABLE_UPDATES: "true",
      AGENTCOMPANY_DISABLE_SINGLE_INSTANCE: "true",
    },
  });

  try {
    const page = await app.firstWindow();

    // Verify the window appeared and has content
    await expect(page.getByText("AgentCompany Desktop")).toBeVisible({ timeout: 30_000 });

    // Verify the window has reasonable dimensions (not collapsed or zero-size)
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (viewport) {
      expect(viewport.width).toBeGreaterThan(400);
      expect(viewport.height).toBeGreaterThan(300);
    }

    // Capture screenshot for D-07 validation evidence
    const platformName = process.platform === "darwin" ? "macos"
      : process.platform === "win32" ? "windows"
      : "linux";
    const screenshotPath = join(screenshotDir, `launch-${platformName}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Verify screenshot was actually written
    expect(existsSync(screenshotPath)).toBeTruthy();

    console.log(`[platform-launch] Screenshot saved: ${screenshotPath}`);
  } finally {
    await app.close();
    await rm(profileDir, { recursive: true, force: true });
  }
});
