import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";
import { closeApp, onboard } from "./onboard";

test("typed input survives page switches, and leaving or closing asks before it is lost", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-unsaved-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-unsaved-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  try {
    const page = await app.firstWindow();
    await onboard(page, "Unsaved Co");
    const composer = page.getByRole("textbox", { name: "Message" });

    // An unsent message is kept when another page is opened and comes back with the conversation.
    await page.getByRole("button", { name: "Messages" }).click();
    await composer.fill("hello team");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(composer).toHaveValue("");
    await composer.fill("unsent words");
    await page.getByRole("button", { name: "Home" }).click();
    await page.getByRole("button", { name: "Messages" }).click();
    await expect(composer).toHaveValue("unsent words");

    // Closing the window with it asks first; staying keeps the app running.
    await app.evaluate(({ dialog }) => {
      (globalThis as unknown as { asked: number }).asked = 0;
      dialog.showMessageBoxSync = () => {
        (globalThis as unknown as { asked: number }).asked += 1;
        return 1;
      };
    });
    await page.evaluate(() => void (window as unknown as { agentCompany: { windowClose: () => Promise<unknown> } }).agentCompany.windowClose());
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { asked: number }).asked)).toBe(1);
    await expect(composer).toHaveValue("unsent words");

    // An edit in progress is lost by leaving the page, so leaving asks.
    await page.getByRole("button", { name: "Edit message" }).first().click();
    await page.getByRole("textbox", { name: "Edit message" }).fill("hello team, edited");
    await page.getByRole("button", { name: "Home" }).click();
    const leave = page.getByRole("alertdialog", { name: "Leave this page?" });
    await leave.getByRole("button", { name: "Stay" }).click();
    await expect(page.getByRole("textbox", { name: "Edit message" })).toHaveValue("hello team, edited");
    await page.getByRole("button", { name: "Home" }).click();
    await leave.getByRole("button", { name: "Leave" }).click();
    await expect(leave).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Edit message" })).toHaveCount(0);

    // A command picked from the menu is unsent input too, though no key was typed.
    const asked = () => app.evaluate(() => (globalThis as unknown as { asked: number }).asked);
    await page.getByRole("button", { name: "Messages" }).click();
    await composer.fill("");
    await page.getByRole("button", { name: "Commands" }).click();
    await page.getByRole("button", { name: "/handoff" }).click();
    await expect(composer).toHaveValue("/handoff ");
    await page.evaluate(() => void (window as unknown as { agentCompany: { windowClose: () => Promise<unknown> } }).agentCompany.windowClose());
    await expect.poll(asked).toBe(2);

    // Settings sections are left like pages: an edited limit is not dropped silently.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Providers" }).click();
    await page.getByLabel("OpenAI monthly request limit").fill("77");
    await page.getByRole("button", { name: "General" }).click();
    await leave.getByRole("button", { name: "Stay" }).click();
    await expect(page.getByLabel("OpenAI monthly request limit")).toHaveValue("77");
    await page.getByRole("button", { name: "General" }).click();
    await leave.getByRole("button", { name: "Leave" }).click();
    await expect(page.getByLabel("OpenAI monthly request limit")).toHaveCount(0);

    // Starting another company replaces the screen, so it asks too.
    await page.getByRole("button", { name: "Providers" }).click();
    await page.getByLabel("OpenAI monthly request limit").fill("78");
    await page.getByRole("button", { name: "Unsaved Co — switch organization" }).click();
    await page.getByRole("menuitem", { name: "New organization" }).click();
    await leave.getByRole("button", { name: "Stay" }).click();
    await expect(page.getByLabel("OpenAI monthly request limit")).toHaveValue("78");
  } finally {
    await closeApp(app);
  }
});
