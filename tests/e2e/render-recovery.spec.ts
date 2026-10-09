import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";
import { onboard } from "./onboard";

test("a record that breaks one page leaves the rest of the app working", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-render-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-render-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  try {
    const page = await app.firstWindow();
    await onboard(page, "Render Co");

    // A pending request with a risk level the Approvals page cannot draw.
    const db = new DatabaseSync(join(profileDir, "agentcompany.db"));
    const orgId = (db.prepare("select id from organizations").get() as { id: string }).id;
    db.prepare("insert into approvals(id, org_id, kind, title, details, risk, requested_by_type, state, created_at) values ('app_bad', ?, 'task_risk', 'Broken request', 'd', 'unknown', 'system', 'pending', ?)")
      .run(orgId, new Date().toISOString());
    db.close();
    // Written behind the app's back, so the test announces it as the app's own changes are.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send("agentcompany:renderer-event", { type: "snapshot-changed", version: Number.MAX_SAFE_INTEGER });
    });

    await page.getByRole("button", { name: "Approvals" }).click();
    const failure = page.getByRole("alert").filter({ hasText: "This page could not be shown." });
    await expect(failure).toContainText("Approval risk tone is missing.");
    await page.getByRole("button", { name: "Home" }).click();
    await expect(failure).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approvals" })).toBeVisible();
  } finally {
    await app.close();
  }
});
