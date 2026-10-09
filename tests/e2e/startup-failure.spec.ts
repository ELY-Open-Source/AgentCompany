import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";
import { closeApp, onboard } from "./onboard";

test("a first load that fails says why, keeps retrying, and recovers", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-startup-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const launch = () => electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0" },
  });
  const setDraft = (json: string | null) => {
    const db = new DatabaseSync(join(profileDir, "agentcompany.db"));
    db.prepare("update app_state set onboarding_draft_json = ? where id = 1").run(json);
    db.close();
  };

  let app = await launch();
  let page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await app.close();

  // A stored value the snapshot cannot read makes every load fail.
  setDraft("{");
  app = await launch();
  page = await app.firstWindow();
  const failure = page.getByRole("alert");
  await expect(failure).toContainText("AgentCompany could not load its data.");
  await expect(failure).toContainText("JSON");
  await expect(failure).toContainText(/attempt [2-9]/);

  setDraft(null);
  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await app.close();
});

test("data that can no longer be updated says so, from when it is, and recovers", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-stale-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-stale-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  const setDraft = (json: string | null) => {
    const db = new DatabaseSync(join(profileDir, "agentcompany.db"));
    db.prepare("update app_state set onboarding_draft_json = ? where id = 1").run(json);
    db.close();
  };
  const announceChange = () => app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send("agentcompany:renderer-event", { type: "snapshot-changed" });
  });
  try {
    const page = await app.firstWindow();
    await onboard(page, "Stale Co");
    setDraft("{");
    await announceChange();
    const banner = page.getByRole("alert").filter({ hasText: "Not up to date." });
    await expect(banner).toContainText("Showing data from");
    await expect(banner).toContainText("JSON");
    // The rest of the app stays usable with the old data on screen.
    await page.getByRole("button", { name: "Work" }).click();
    setDraft(null);
    await banner.getByRole("button", { name: "Retry now" }).click();
    await expect(banner).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});
