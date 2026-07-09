import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";

test("captures every page for visual review", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-shots-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: {
      ...process.env,
      AGENTCOMPANY_NEW_PROFILE_DIR: profileDir,
      AGENTCOMPANY_NEW_AUTORUN: "0",
      AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: seedBuiltinSkillsFixture(join(profileDir, "builtin-src")),
    },
  });
  const outDir = resolve("test-results/screenshots");
  mkdirSync(outDir, { recursive: true });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: join(outDir, "00-onboarding-welcome.png"), fullPage: false });

    await page.getByRole("button", { name: "Get started" }).click();
    await page.screenshot({ path: join(outDir, "01-onboarding-provider.png"), fullPage: false });
    await page.getByLabel("API key").fill("local-dev-key");
    await page.getByLabel("Model").fill("gpt-5.4");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Company name").fill("OrbitOps");
    await page.getByLabel("Your name").fill("Yu Chen");
    await page.getByLabel("Description").fill("Multi-agent operations platform.");
    await page.screenshot({ path: join(outDir, "02-onboarding-company.png"), fullPage: false });
    await page.getByRole("button", { name: "Continue" }).click();

    await page.screenshot({ path: join(outDir, "03-onboarding-mode.png"), fullPage: false });
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Goal").fill("Ship the v1 launch by July.");
    await page.getByLabel("Acceptance criteria").fill("Pricing model + landing page + 3 pilot signups.");
    await page.screenshot({ path: join(outDir, "04-onboarding-goal.png"), fullPage: false });
    await page.getByRole("button", { name: "Launch" }).click();

    await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
    await page.screenshot({ path: join(outDir, "05-onboarding-connectors.png"), fullPage: false });
    await page.getByRole("button", { name: "Finish" }).click();

    await expect(page.getByRole("button", { name: /OrbitOps/ })).toBeVisible();
    await snap(page, outDir, "10-home");

    await go(page, "Team", outDir, "11-team");
    await go(page, "Work", outDir, "12-work");
    await go(page, "Messages", outDir, "13-messages");
    await go(page, "Files", outDir, "14-files");
    await go(page, "Approvals", outDir, "15-approvals");
    await go(page, "Connectors", outDir, "16-connectors");
    await go(page, "Settings", outDir, "17-settings");
    await go(page, "Office", outDir, "18-office");

    for (const tab of ["General", "Providers", "Advanced"]) {
      await page.getByRole("button", { name: "Settings" }).click();
      await page.getByRole("button", { name: tab }).first().click();
      await snap(page, outDir, `settings-${tab.toLowerCase()}`);
    }

    await page.setViewportSize({ width: 980, height: 700 });
    await go(page, "Home", outDir, "20-narrow-home");
    await go(page, "Messages", outDir, "21-narrow-messages");
    await go(page, "Files", outDir, "22-narrow-files");
  } finally {
    await app.close();
  }
});

async function go(page: Page, nav: string, dir: string, name: string): Promise<void> {
  await page.getByRole("button", { name: nav, exact: true }).click();
  await snap(page, dir, name);
}

async function snap(page: Page, dir: string, name: string): Promise<void> {
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: false });
}
