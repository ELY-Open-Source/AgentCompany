import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";
import { closeApp, onboard } from "./onboard";
import { offGridText } from "./pixel-grid";

test("every page and onboarding step draws its text on the pixel font's grid", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-pxpages-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-pxpages-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    expect(await offGridText(page)).toEqual([]);
    await onboard(page, "Grid Co");
    await page.evaluate(() => window.agentCompany.setIntegrationKey({ name: "composio", value: "ak_e2e" }));
    for (const route of ["Home", "Work", "Team", "Office", "Messages", "Runs", "Files", "Library", "Approvals", "Connectors", "Settings"]) {
      await page.getByRole("button", { name: route, exact: true }).click();
      await page.waitForTimeout(400);
      expect({ route, odd: await offGridText(page) }).toEqual({ route, odd: [] });
    }
  } finally {
    await closeApp(app);
  }
});
