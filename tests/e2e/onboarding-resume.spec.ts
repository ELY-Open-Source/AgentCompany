import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";

test("onboarding resumes where it was left after the app is closed", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-resume-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-resume-builtin-${randomUUID()}`));
  const launch = () => electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });

  // Fill the first steps, then close the app mid-wizard.
  let app = await launch();
  let page = await app.firstWindow();
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("API key").fill("e2e-secret");
  await page.getByLabel("Model").fill("gpt-5.4");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Company name").fill("Resume Co");
  await page.getByLabel("Your name").fill("Dana Lee");
  await page.getByLabel("Description").fill("Survives a restart.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Mode" })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const api = (window as unknown as { agentCompany: { loadSnapshot: () => Promise<{ ok: true; data: { onboardingDraft: { step: string; companyName: string } | null } }> } }).agentCompany;
    const draft = (await api.loadSnapshot()).data.onboardingDraft;
    return draft && `${draft.step}:${draft.companyName}`;
  })).toBe("mode:Resume Co");
  await app.close();

  // The wizard comes back on the same step with what was typed; the key is not kept.
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Mode" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Your progress was restored." })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Company name")).toHaveValue("Resume Co");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("API key")).toHaveValue("");
  await page.getByLabel("API key").fill("e2e-secret");
  await page.getByLabel("Model").fill("gpt-5.4");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Goal").fill("Ship it.");
  await page.getByLabel("Acceptance criteria").fill("It ships.");
  await page.getByRole("button", { name: "Launch" }).click();
  await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
  await app.close();

  // A company whose setup was not finished reopens on the connectors step, then enters the app.
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
  // The step says when connector statuses could not be checked, as the Connectors page does.
  await expect(page.getByRole("alert").filter({ hasText: "Account status could not be checked with Composio" })).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

  // A cancelled second company leaves nothing behind for the next attempt.
  const savedModel = () => page.evaluate(async () => {
    const api = (window as unknown as { agentCompany: { loadSnapshot: () => Promise<{ ok: true; data: { onboardingDraft: { providerModel: string } | null } }> } }).agentCompany;
    return (await api.loadSnapshot()).data.onboardingDraft?.providerModel ?? null;
  });
  await page.getByRole("button", { name: "Resume Co — switch organization" }).click();
  await page.getByRole("menuitem", { name: "New organization" }).click();
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("API key").fill("e2e-secret");
  await page.getByLabel("Model").fill("cancelled-model");
  await expect.poll(savedModel).toBe("cancelled-model");
  // Saving a preference refreshes the in-memory snapshot, which now holds the draft too.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("radio", { name: "中文" }).click();
  await page.getByRole("radio", { name: "English" }).click();
  // Past the 800 ms change-event reload window, so only Cancel itself can refresh the snapshot.
  await page.waitForTimeout(1_200);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  expect(await savedModel()).toBeNull();
  await page.getByRole("button", { name: "Resume Co — switch organization" }).click();
  await page.getByRole("menuitem", { name: "New organization" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your progress was restored." })).toHaveCount(0);
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("API key").fill("e2e-secret");
  await expect(page.getByLabel("Model")).not.toHaveValue("cancelled-model");
  await page.getByRole("button", { name: "Cancel" }).click();
  await app.close();

  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connectors" })).toHaveCount(0);
  await app.close();
});
