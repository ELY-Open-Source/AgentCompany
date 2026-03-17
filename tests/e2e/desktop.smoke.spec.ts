import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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
    await page.getByRole("button", { name: /Custom Setup/i }).click();
    await page.getByLabel("Company name").fill("Orbit Foundry");
    await page.getByLabel("Workspace folder").fill(workspaceDir);
    await page.getByRole("button", { name: /^Continue$/i }).click();
    await page.getByLabel("Goal").fill("Launch the company");
    await page.getByRole("button", { name: /Launch your company/i }).click();

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    // Company name is rendered in a custom dropdown trigger button in the sidebar.
    await expect(page.locator("aside button", { hasText: "Orbit Foundry" }).first()).toBeVisible();
    const showConsoleButton = page.getByRole("button", { name: /show console/i });
    await expect(showConsoleButton).toBeVisible();
    await showConsoleButton.click();
    await expect(page.getByText("Console", { exact: true })).toBeVisible();
    const hideConsoleButton = page.getByRole("button", { name: /hide console/i });
    await expect(hideConsoleButton).toBeVisible();
    await hideConsoleButton.click();
    await expect(page.getByText("Console", { exact: true })).toBeHidden();
    await expect(showConsoleButton).toBeVisible();
  } finally {
    await app.close();
    await rm(profileDir, { recursive: true, force: true });
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
