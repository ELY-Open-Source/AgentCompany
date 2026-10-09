import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

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
