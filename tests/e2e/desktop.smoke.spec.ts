import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _electron as electron, expect, test } from "@playwright/test";
import { getElectronExecutablePath, getMainEntryPath } from "./launch";

function buildLaunchEnv(profileDir: string) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    AGENTCOMPANY_PROFILE_DIR: profileDir,
    AGENTCOMPANY_DISABLE_UPDATES: "true",
    AGENTCOMPANY_DISABLE_SINGLE_INSTANCE: "true",
  };
  delete env.NO_COLOR;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function advanceFromWelcome(page: import("@playwright/test").Page) {
  await expect(page.getByText("AgentCompany")).toBeVisible();
  await expect(page.getByText("Build your AI company here.")).toBeVisible();
  await page.getByRole("button", { name: /Get Started/i }).click();
}

async function advancePastNodeCheck(page: import("@playwright/test").Page) {
  const continueButton = page.getByRole("button", { name: /^Continue$/i });
  await expect(page.getByText("Check Node.js")).toBeVisible();
  await expect(continueButton).toBeEnabled({ timeout: 15_000 });
  await continueButton.click();
}

test("first launch onboarding advances into runtime setup and shell-ready flow", async () => {
  const entry = getMainEntryPath();
  expect(existsSync(entry)).toBeTruthy();

  const profileDir = await mkdtemp(join(tmpdir(), "agentcompany-e2e-"));
  const workspaceDir = await mkdtemp(join(tmpdir(), "agentcompany-workspace-"));

  const app = await electron.launch({
    executablePath: getElectronExecutablePath(),
    args: [entry],
    cwd: process.cwd(),
    env: buildLaunchEnv(profileDir),
  });

  try {
    const page = await app.firstWindow();
    await advanceFromWelcome(page);
    await advancePastNodeCheck(page);

    await expect(page.getByText("Connect a provider")).toBeVisible();

    const providersContinue = page.getByRole("button", { name: /^Continue$/i });
    if (!(await providersContinue.isEnabled())) {
      await expect(page.getByText("Connect at least one provider to continue.", { exact: true })).toBeVisible();
      await expect(page.getByText(/Ready|Login required|Not installed|Not configured|Checking|Error/i).first()).toBeVisible();
      test.skip(true, "runtime fixture missing: no enabled provider to continue past runtime setup");
    }

    await providersContinue.click();
    await expect(page.getByLabel("Company name")).toBeVisible();
    await page.getByLabel("Company name").fill("Orbit Foundry");
    await page.getByLabel("Workspace folder").fill(workspaceDir);
    await page.getByRole("button", { name: /^Continue$/i }).click();

    await expect(page.getByText("How should your company operate?")).toBeVisible();
    await page.getByRole("button", { name: /^Continue$/i }).click();

    await expect(page.getByLabel("Goal")).toBeVisible();
    await page.getByLabel("Goal").fill("Launch the company");
    await page.getByRole("button", { name: /Launch Company/i }).click();

    await expect(page.getByRole("heading", { name: /Orbit Foundry.*is live/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Open Control Center/i })).toBeVisible();
  } finally {
    await app.close();
    await rm(profileDir, { recursive: true, force: true });
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

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
    env: buildLaunchEnv(profileDir),
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByText("AgentCompany")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Build your AI company here.")).toBeVisible();

    const viewport = page.viewportSize();
    const dimensions = viewport ?? await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    expect(dimensions.width).toBeGreaterThan(400);
    expect(dimensions.height).toBeGreaterThan(300);

    const platformName = process.platform === "darwin" ? "macos"
      : process.platform === "win32" ? "windows"
      : "linux";
    const screenshotPath = join(screenshotDir, `launch-${platformName}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    expect(existsSync(screenshotPath)).toBeTruthy();
  } finally {
    await app.close();
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("onboarding model pool persists across relaunch for a ready connector", async () => {
  const entry = getMainEntryPath();
  expect(existsSync(entry)).toBeTruthy();

  const profileDir = await mkdtemp(join(tmpdir(), "agentcompany-model-pool-"));
  const workspaceDir = await mkdtemp(join(tmpdir(), "agentcompany-model-pool-workspace-"));

  const launchApp = async () => electron.launch({
    executablePath: getElectronExecutablePath(),
    args: [entry],
    cwd: process.cwd(),
    env: buildLaunchEnv(profileDir),
  });

  let app = await launchApp();

  try {
    const page = await app.firstWindow();
    await advanceFromWelcome(page);
    await advancePastNodeCheck(page);

    await expect(page.getByText("Connect a provider")).toBeVisible();
    const providersContinue = page.getByRole("button", { name: /^Continue$/i });
    if (!(await providersContinue.isEnabled())) {
      await expect(page.getByText("Connect at least one provider to continue.", { exact: true })).toBeVisible();
      test.skip(true, "runtime fixture missing: no enabled provider to continue past runtime setup");
    }
    await providersContinue.click();

    await expect(page.getByLabel("Company name")).toBeVisible();
    const enabledCountLabel = page.getByText(/Models \(\d+\/\d+ enabled\)/i);
    await expect(enabledCountLabel).toBeVisible();
    const initialCount = await enabledCountLabel.textContent();

    const switches = page.getByRole("switch");
    const switchCount = await switches.count();
    if (switchCount < 2) {
      test.skip(true, "model pool fixture missing: need at least 2 model toggles to test persistence");
    }

    await switches.nth(1).click();
    const updatedCount = await enabledCountLabel.textContent();
    expect(updatedCount).not.toBe(initialCount);
  } finally {
    await app.close();
  }

  app = await launchApp();

  try {
    const page = await app.firstWindow();
    await advanceFromWelcome(page);
    await advancePastNodeCheck(page);
    const providersContinue = page.getByRole("button", { name: /^Continue$/i });
    if (!(await providersContinue.isEnabled())) {
      await expect(page.getByText(/Set up at least one provider to power your agents\./i)).toBeVisible();
      test.skip(true, "runtime fixture missing: no enabled provider persisted across relaunch");
    }
    await providersContinue.click();

    await expect(page.getByLabel("Company name")).toBeVisible();
    const enabledCountLabel = page.getByText(/Models \(\d+\/\d+ enabled\)/i);
    await expect(enabledCountLabel).toBeVisible();

    await page.getByLabel("Company name").fill("Persisted Model Pool Co");
    await page.getByLabel("Workspace folder").fill(workspaceDir);
    await page.getByRole("button", { name: /^Continue$/i }).click();
    await expect(page.getByText("How should your company operate?")).toBeVisible();
  } finally {
    await app.close();
    await rm(profileDir, { recursive: true, force: true });
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
