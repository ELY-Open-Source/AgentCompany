import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";
import { closeApp, onboard } from "./onboard";

test("a dialog keeps the keyboard inside it, closes on Escape, and gives focus back", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-keys-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-keys-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  try {
    const page = await app.firstWindow();
    await onboard(page, "Keys Co");
    await page.getByRole("button", { name: "Work" }).click();
    const opener = page.getByRole("button", { name: "New task" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    await expect(dialog).toBeVisible();
    const focusInDialog = () => page.evaluate(() => Boolean(document.activeElement?.closest("[aria-modal=true]")));
    // Focus starts inside, and the app behind cannot be reached.
    expect(await focusInDialog()).toBe(true);
    expect(await page.evaluate(() => document.getElementById("root")!.inert)).toBe(true);
    for (let press = 0; press < 25; press += 1) {
      await page.keyboard.press("Tab");
      expect(await focusInDialog()).toBe(true);
    }
    for (let press = 0; press < 25; press += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusInDialog()).toBe(true);
    }
    // Escape closes an untouched dialog and focus returns to what opened it.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => document.getElementById("root")!.inert)).toBe(false);
    // With something typed, Escape asks first.
    await opener.click();
    await dialog.getByLabel("Title").fill("Draft");
    await page.keyboard.press("Escape");
    // The question is its own layer: focus moves into it, and Escape there keeps editing.
    const confirm = page.getByRole("alertdialog", { name: "Discard your changes?" });
    await expect(confirm).toBeVisible();
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role=alertdialog]")))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(dialog.getByLabel("Title")).toBeFocused();
    await page.keyboard.press("Escape");
    await confirm.getByRole("button", { name: "Discard" }).click();
    await expect(dialog).toHaveCount(0);
    // Both layers closed at once; focus still returns to what opened the dialog.
    await expect(opener).toBeFocused();
  } finally {
    await closeApp(app);
  }
});
