import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";
import { onboard } from "./onboard";

test("a dialog submitted twice in a row creates one record", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-double-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-double-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  try {
    const page = await app.firstWindow();
    await onboard(page, "Double Co");
    await page.getByRole("button", { name: "Work" }).click();
    await page.getByRole("button", { name: "Goal", exact: true }).click();
    await page.locator(".modal").getByLabel("Title").fill("Only once");
    await page.locator(".modal").getByLabel("Description").fill("d");
    // Two submits in the same tick, as an impatient double click sends them.
    await page.locator(".modal").evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
      (form as HTMLFormElement).requestSubmit();
    });
    await expect(page.locator(".modal")).toHaveCount(0);
    const titles = await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: { loadSnapshot: () => Promise<{ ok: true; data: { goals: Array<{ title: string }> } }> } }).agentCompany;
      return (await api.loadSnapshot()).data.goals.map((goal) => goal.title).filter((title) => title === "Only once");
    });
    expect(titles).toEqual(["Only once"]);
  } finally {
    await app.close();
  }
});
