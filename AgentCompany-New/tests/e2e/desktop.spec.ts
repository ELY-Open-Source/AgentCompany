import { _electron as electron, expect, test, type Page } from "@playwright/test";
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
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByLabel("API key").fill("e2e-secret");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Company name").fill("Acme Operations");
    await page.getByLabel("Your name").fill("Dana Lee");
    await page.getByLabel("Description").fill("Coordinate agents with auditable approvals.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Goal").fill("Ship a verified control plane.");
    await page.getByLabel("Acceptance criteria").fill("The CEO creates the kickoff operating loop.");
    await page.getByRole("button", { name: "Launch" }).click();

    await expect(page.getByRole("button", { name: /Acme Operations/ })).toBeVisible();
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

    await page.getByRole("button", { name: "Messages" }).click();
    await page.getByRole("button", { name: "New space" }).click();
    await page.getByLabel("Name").fill("release");
    await page.getByLabel("Topic").fill("Release coordination");
    await page.locator(".modal").getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("release").first()).toBeVisible();
    await page.getByRole("textbox", { name: "Message" }).fill("/escalate @Board review release plan");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("@Board").first()).toBeVisible();
    await expect(page.getByText("/escalate").first()).toBeVisible();
    await page.getByRole("button", { name: "Open thread" }).first().click();
    await expect(page.getByText("Audit")).toBeVisible();
    await expect(page.getByText("chat_message.sent").first()).toBeVisible();
    await expect(page.getByText("approval.requested").first()).toBeVisible();
    await page.getByRole("button", { name: "Approvals" }).click();
    await expect(page.getByText("Escalate release").first()).toBeVisible();

    await page.getByRole("button", { name: "Social" }).click();
    await page.getByRole("button", { name: "Connect account" }).click();
    await page.getByLabel("Handle").fill("@acme");
    await page.getByLabel("Display name").fill("Acme Social");
    await page.locator(".modal").getByRole("button", { name: "Connect" }).click();
    await expect(page.getByText("@acme").first()).toBeVisible();
    await page.getByRole("button", { name: "Draft post" }).click();
    await page.getByLabel("Body").fill("Pilot starts Friday.");
    await page.getByLabel("Scheduled for").fill("2027-01-15T09:30");
    await page.locator(".modal").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Draft").first()).toBeVisible();
    await page.getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByText("Awaiting approval").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();

    await page.getByRole("button", { name: "Approvals" }).click();
    await expect(page.getByText("Approve social post").first()).toBeVisible();
    await page.getByLabel("Filter risk").selectOption("medium");
    await page.getByRole("button", { name: /^Approve$/ }).first().click();
    await page.getByRole("button", { name: "Social" }).click();
    await expect(page.getByText("Approved").first()).toBeVisible();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Published").first()).toBeVisible();

    await verifyPagesDoNotOverflow(page);
  } finally {
    await app.close();
  }
});

async function verifyPagesDoNotOverflow(page: Page): Promise<void> {
  for (const size of [{ width: 1280, height: 860 }, { width: 980, height: 700 }]) {
    await page.setViewportSize(size);
    for (const nav of ["Home", "Team", "Work", "Messages", "Files", "Approvals", "Social", "Settings"]) {
      await page.getByRole("button", { name: nav }).click();
      await expectPageToFit(page);
    }
    for (const tab of ["Workspace", "Members", "Billing", "Models", "Providers", "Skills", "Policies", "Migration", "Profile", "Notifications", "Security"]) {
      await page.getByRole("button", { name: "Settings" }).click();
      await page.getByRole("button", { name: tab }).click();
      await expectPageToFit(page);
    }
  }
}

async function expectPageToFit(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }));
  expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentClientWidth + 1);
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth + 1);
}
