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

    // A one-of choice says which option is chosen, and the arrow keys move the choice.
    const views = page.getByRole("radiogroup", { name: "View" });
    await expect(views.getByRole("radio", { name: "Board" })).toHaveAttribute("aria-checked", "true");
    await views.getByRole("radio", { name: "Board" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(views.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
    await expect(views.getByRole("radio", { name: "List" })).toBeFocused();
    await expect(views.getByRole("radio", { name: "Board" })).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Home");
    await expect(views.getByRole("radio", { name: "Board" })).toHaveAttribute("aria-checked", "true");
  } finally {
    await closeApp(app);
  }
});

test("mention suggestions are announced, and an input method's Enter never picks a person", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-mention-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-mention-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  try {
    const page = await app.firstWindow();
    await onboard(page, "Mention Co");
    await page.getByRole("button", { name: "Messages" }).click();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("@");
    await composer.press("End");
    await composer.type("c");
    const list = page.getByRole("listbox", { name: "People to mention" });
    await expect(list).toBeVisible();
    const active = await composer.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    await expect(list.locator(`[id="${active}"]`)).toHaveAttribute("aria-selected", "true");
    // An Enter that confirms composed text (isComposing) leaves the words as typed.
    await composer.evaluate((node) => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
    await expect(composer).toHaveValue("@c");
    await expect(list).toBeVisible();
    // A plain Enter picks the highlighted person.
    await composer.press("Enter");
    await expect(composer).toHaveValue(/^@\S+ $/);
    await expect(list).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

test("the list width, office people and chart values all work from the keyboard and read as text", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-nomouse-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-nomouse-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  try {
    const page = await app.firstWindow();
    await onboard(page, "No Mouse Co");

    // A chart is one stop in the Tab order; arrows read its values aloud, and all of them are listed as text.
    await page.getByRole("button", { name: "Home" }).click();
    const runs = page.getByRole("region", { name: "Run activity" });
    const chart = runs.getByRole("group", { name: /Run activity: use the arrow keys/ });
    await chart.focus();
    await page.keyboard.press("Home");
    const readout = runs.locator("[aria-live=polite]");
    await expect(readout).toHaveText(/^\S+ · 0$/);
    const values = runs.locator(".sr-only li");
    await expect(values).toHaveCount(7);
    await expect(readout).toHaveText((await values.nth(0).textContent())!.replace(": ", " · "));
    await page.keyboard.press("End");
    await expect(readout).toHaveText((await values.nth(6).textContent())!.replace(": ", " · "));
    await page.keyboard.press("ArrowLeft");
    await expect(readout).toHaveText((await values.nth(5).textContent())!.replace(": ", " · "));
    await page.keyboard.press("Tab");
    await expect(readout).toHaveText(/in the last 7 days/);

    // The conversation list resizes with the arrow keys, within its limits, and keeps the width.
    await page.getByRole("button", { name: "Messages" }).click();
    const handle = page.getByRole("separator", { name: "Resize conversation list" });
    await handle.focus();
    const before = Number(await handle.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", String(Math.min(480, before + 16)));
    await page.keyboard.press("End");
    await expect(handle).toHaveAttribute("aria-valuenow", "480");
    await page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", "200");
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "200");
    expect(await page.evaluate(() => window.localStorage.getItem("agentcompany:chat-pane-width"))).toBe("200");

    // In the office, each person can be chosen from a list, and the floor says who is there.
    await page.getByRole("button", { name: "Office", exact: true }).click();
    await expect(page.getByRole("img", { name: /People here: 1./ })).toBeVisible();
    const people = page.getByRole("combobox", { name: "Show a person" });
    // The only person is the CEO, listed after the empty choice with whatever state their real work gives them.
    await people.selectOption({ index: 1 });
    await expect(page.getByRole("dialog", { name: "Agent CEO" })).toBeVisible();
    await people.selectOption({ label: "Show a person…" });
    await expect(page.getByRole("dialog", { name: "Agent CEO" })).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});
