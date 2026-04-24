import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { createElectronLaunchEnv, getElectronExecutablePath, getMainEntryPath } from "./launch";
import {
  E2E_READY_CONNECTOR_ID,
  E2E_READY_CONNECTOR_MODEL_ID,
  E2E_PROVIDER_API_KEY,
  readOnboardingProfileState,
} from "./onboarding-fixture";

function buildLaunchEnv(profileDir: string) {
  return createElectronLaunchEnv({
    AGENTCOMPANY_PROFILE_DIR: profileDir,
    AGENTCOMPANY_DISABLE_UPDATES: "true",
    AGENTCOMPANY_DISABLE_SINGLE_INSTANCE: "true",
    AGENTCOMPANY_ALLOW_INSECURE_VAULT: "true",
  });
}

async function launchDesktopApp(profileDir: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: getElectronExecutablePath(),
    args: [getMainEntryPath()],
    cwd: process.cwd(),
    env: buildLaunchEnv(profileDir),
  });
}

async function advanceFromWelcome(page: Page) {
  await expect(page.getByText("AgentCompany")).toBeVisible();
  await expect(page.getByText("Build your AI company here.")).toBeVisible();
  await page.getByRole("button", { name: /Get Started/i }).click();
}

async function advancePastNodeCheck(page: Page) {
  const continueButton = page.getByRole("button", { name: /^Continue$/i });
  await expect(page.getByText("Check Node.js")).toBeVisible();
  await expect(continueButton).toBeEnabled({ timeout: 15_000 });
  await continueButton.click();
}

async function configureReadyProvider(page: Page) {
  await expect(page.getByText("Anthropic API")).toBeVisible();
  await page.getByRole("button", { name: /Anthropic API/i }).click();
  const apiKeyInput = page.locator('input[type="password"]').first();
  await expect(apiKeyInput).toBeVisible();
  await apiKeyInput.fill(E2E_PROVIDER_API_KEY);
  await page.getByRole("button", { name: /^Save$/i }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Connected").first()).toBeVisible({ timeout: 15_000 });
}

async function completeOnboardingToLaunch(
  page: Page,
  input: {
    companyName: string;
    workspaceDir: string;
    goalTitle: string;
    toggleSecondModel?: boolean;
  },
) {
  await advanceFromWelcome(page);
  await advancePastNodeCheck(page);

  await expect(page.getByText("Connect a provider")).toBeVisible();
  await configureReadyProvider(page);
  const providersContinue = page.getByRole("button", { name: /^Continue$/i });
  await expect(providersContinue).toBeEnabled({ timeout: 30_000 });
  await providersContinue.click();

  await expect(page.getByLabel("Company name")).toBeVisible();
  await page.getByLabel("Company name").fill(input.companyName);
  await page.getByLabel("Workspace folder").fill(input.workspaceDir);
  await expect(page.getByLabel("Provider")).toHaveValue(E2E_READY_CONNECTOR_ID);
  await expect(page.getByLabel("Model")).toHaveValue(E2E_READY_CONNECTOR_MODEL_ID);
  await page.getByRole("button", { name: /^Continue$/i }).click();

  await expect(page.getByText("Choose team models")).toBeVisible();
  const enabledCountLabel = page.getByText(/\d+ \/ \d+ models enabled/i).first();
  await expect(enabledCountLabel).toBeVisible();
  const initialEnabledCount = await enabledCountLabel.textContent();
  const switches = page.getByRole("switch");
  await expect(switches.nth(1)).toBeVisible();
  if (input.toggleSecondModel) {
    await switches.nth(1).click();
    await expect.poll(async () => enabledCountLabel.textContent()).not.toBe(initialEnabledCount);
  }
  await page.getByRole("button", { name: /^Continue$/i }).click();

  await expect(page.getByText("How should it run?")).toBeVisible();
  await page.getByRole("button", { name: /^Continue$/i }).click();

  await expect(page.getByLabel("Goal")).toBeVisible();
  await page.getByLabel("Goal").fill(input.goalTitle);
  await page.getByRole("button", { name: /Launch Company/i }).click();

  await expect(page.getByRole("heading", { name: new RegExp(`${input.companyName}.*is live`, "i") })).toBeVisible();
  await expect(page.getByText("Queued in orchestration")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open Control Center/i })).toBeVisible();
}

test("first launch onboarding advances into runtime setup and shell-ready flow", async () => {
  const entry = getMainEntryPath();
  expect(existsSync(entry)).toBeTruthy();

  const profileDir = await mkdtemp(join(tmpdir(), "agentcompany-e2e-"));
  const workspaceDir = await mkdtemp(join(tmpdir(), "agentcompany-workspace-"));

  let app: ElectronApplication | null = await launchDesktopApp(profileDir);

  try {
    const page = await app.firstWindow();
    await completeOnboardingToLaunch(page, {
      companyName: "Orbit Foundry",
      workspaceDir,
      goalTitle: "Launch the company",
    });
    await page.getByRole("button", { name: /Open Control Center/i }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Orbit Foundry/i })).toBeVisible();
    await app.close();
    app = null;

    const state = readOnboardingProfileState(profileDir);
    expect(state.companyCount).toBe(1);
    expect(state.currentCompanyName).toBe("Orbit Foundry");
    expect(state.leadAgentConnectorId).toBe(E2E_READY_CONNECTOR_ID);
    expect(state.leadAgentModel).toBe(E2E_READY_CONNECTOR_MODEL_ID);
    expect(state.taskCount).toBeGreaterThanOrEqual(1);
    expect(state.runCount).toBeGreaterThanOrEqual(1);
  } finally {
    await app?.close();
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

  const app = await launchDesktopApp(profileDir);

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

  let app: ElectronApplication | null = await launchDesktopApp(profileDir);

  try {
    const page = await app.firstWindow();
    await completeOnboardingToLaunch(page, {
      companyName: "Persisted Model Pool Co",
      workspaceDir,
      goalTitle: "Keep model pool choices after relaunch",
      toggleSecondModel: true,
    });
    await page.getByRole("button", { name: /Open Control Center/i }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
    await app.close();
    app = null;

    const persistedState = readOnboardingProfileState(profileDir);
    expect(persistedState.currentCompanyName).toBe("Persisted Model Pool Co");
    expect(persistedState.disabledModelCount).toBe(1);

    app = await launchDesktopApp(profileDir);
    const relaunchedPage = await app.firstWindow();
    await expect(relaunchedPage.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
    await expect(relaunchedPage.getByRole("button", { name: /Persisted Model Pool Co/i })).toBeVisible();
  } finally {
    await app?.close();
    await rm(profileDir, { recursive: true, force: true });
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
