import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

test("onboards, hires, and creates work in the Electron shell", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: {
      ...process.env,
      AGENTCOMPANY_NEW_PROFILE_DIR: profileDir,
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "AgentCompany" })).toBeVisible();
    await page.getByLabel("Company name").fill("Acme Operations");
    await page.getByLabel("Your name").fill("Dana Lee");
    await page.getByLabel("Mission").fill("Coordinate agents with auditable approvals.");
    await page.getByLabel("First goal").fill("Ship a verified control plane.");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("heading", { name: "Acme Operations" })).toBeVisible();
    await page.getByRole("button", { name: "Team" }).click();
    await page.getByRole("button", { name: "Hire" }).click();
    await page.getByLabel("Name").fill("Alex Chen");
    await page.getByLabel("Role").fill("CTO");
    await page.getByLabel("Department").fill("Engineering");
    await page.getByLabel("Monthly budget").fill("250");
    await page.locator(".modal").getByRole("button", { name: "Hire" }).click();
    await expect(page.getByText("Alex Chen").first()).toBeVisible();

    await page.getByRole("button", { name: "Work" }).click();
    await page.getByRole("button", { name: "New task" }).click();
    await page.getByLabel("Title").fill("Production deploy");
    await page.getByLabel("Description").fill("Deploy a high-risk change.");
    await page.getByLabel("Risk").selectOption("high");
    await page.locator(".modal").getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Production deploy").first()).toBeVisible();

    await page.getByRole("button", { name: "Approvals" }).click();
    await expect(page.getByText("Production deploy").first()).toBeVisible();
  } finally {
    await app.close();
  }
});
