import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";
import { closeApp, onboard } from "./onboard";

test("switching company leaves nothing of the previous company on screen", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-switch-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-switch-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  try {
    const page = await app.firstWindow();
    await onboard(page, "Alpha Co");
    const searchBox = page.getByRole("dialog", { name: "Search" }).getByRole("textbox");
    await page.locator(".search-kbd").click();
    await searchBox.fill("Alpha search");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Alpha Co — switch organization" }).click();
    await page.getByRole("menuitem", { name: "New organization" }).click();
    await onboard(page, "Beta Co");
    await expect(page.getByRole("button", { name: "Beta Co — switch organization" })).toBeVisible();
    // Switching back keeps the shell on screen, yet search opens fresh in the other company.
    await page.locator(".search-kbd").click();
    await searchBox.fill("Beta search");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Beta Co — switch organization" }).click();
    await page.getByRole("menuitem", { name: /Alpha Co/ }).click();
    await expect(page.getByRole("button", { name: "Alpha Co — switch organization" })).toBeVisible();
    await page.locator(".search-kbd").click();
    await expect(searchBox).toHaveValue("");
  } finally {
    await closeApp(app);
  }
});
