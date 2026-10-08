import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";

test("the library manages documents with versions and knowledge with history", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-library-${randomUUID()}`);
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
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByLabel("API key").fill("library-e2e-key");
    await page.getByLabel("Model").fill("gpt-5.4");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Company name").fill("Stack Works");
    await page.getByLabel("Your name").fill("Robin Park");
    await page.getByLabel("Description").fill("Library e2e coverage.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Goal").fill("Keep company knowledge.");
    await page.getByLabel("Acceptance criteria").fill("Documents and knowledge are manageable.");
    await page.getByRole("button", { name: "Launch" }).click();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("button", { name: /Stack Works/ })).toBeVisible();

    const orgId = await page.evaluate(async () => {
      const snapshot = await window.agentCompany.loadSnapshot();
      if (!snapshot.ok || !snapshot.data.activeOrgId) throw new Error("no org");
      const created = await window.agentCompany.createDocument({
        orgId: snapshot.data.activeOrgId, title: "Pricing memo", docType: "memo", content: "Price is 10.",
        authorAgentId: null, reviewerAgentId: null, projectId: null, goalId: null, taskId: null,
      });
      if (!created.ok) throw new Error(created.error.message);
      return snapshot.data.activeOrgId;
    });
    expect(orgId).toBeTruthy();

    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("listitem").filter({ hasText: "Pricing memo" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Content").fill("Price is 12.");
    await page.getByLabel("Why this change").fill("Costs went up");
    await page.getByRole("button", { name: "Save new version" }).click();
    await expect(page.getByText("Price is 12.")).toBeVisible();
    await page.getByLabel("Version").selectOption("1");
    await expect(page.getByText("Price is 10.")).toBeVisible();

    await page.getByRole("button", { name: "Knowledge", exact: true }).click();
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByLabel("Topic").fill("Refund window");
    await page.getByLabel("Category").fill("policy");
    await page.getByLabel("Content").fill("Refunds within 14 days.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("listitem").filter({ hasText: "Refund window" }).click();
    await page.getByRole("button", { name: "Revise", exact: true }).click();
    await page.getByLabel("Content").fill("Refunds within 30 days.");
    await page.getByLabel("Why this change").fill("Legal update");
    await page.getByRole("button", { name: "Save revision" }).click();
    await expect(page.getByText("Legal update")).toBeVisible();
    await expect(page.getByText("Refunds within 14 days.")).toBeVisible();
  } finally {
    await app.close();
  }
});
