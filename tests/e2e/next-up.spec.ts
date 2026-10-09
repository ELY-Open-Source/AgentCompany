import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";
import { closeApp, onboard } from "./onboard";

test("Home shows one ordered list of what needs you, with why work stopped, and else the next task in line", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-nextup-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-nextup-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  try {
    const page = await app.firstWindow();
    await onboard(page, "Next Up Co");
    const blocked = await page.evaluate(async () => {
      type Api = Record<string, (input?: unknown) => Promise<{ ok: boolean; data: { activeOrgId: string; tasks: Array<{ id: string; title: string }> } }>>;
      const api = (window as unknown as { agentCompany: Api }).agentCompany;
      const seeded = (await api.loadSnapshot()).data;
      const orgId = seeded.activeOrgId;
      // Onboarding's kickoff task is finished first, so only this test's tasks are open.
      for (const task of seeded.tasks) await api.updateTaskStatus({ orgId, taskId: task.id, status: "done" });
      const base = { orgId, description: "d", status: "backlog", assigneeAgentId: null, risk: "low", projectId: null, goalId: null, workspaceId: null, requiresFilesystem: false };
      await api.createTask({ ...base, title: "Ship pricing page", priority: "normal" });
      await api.createTask({ ...base, title: "Fix login", priority: "high" });
      const id = (await api.loadSnapshot()).data.tasks.find((task) => task.title === "Fix login")!.id;
      await api.setTaskBlocked({ orgId, taskId: id, reason: "Needs the staging key" });
      return { orgId, id };
    });

    await page.getByRole("button", { name: "Home" }).click();
    const card = page.getByRole("region", { name: "Needs you" });
    const stopped = card.getByRole("listitem").filter({ hasText: "Fix login" });
    await expect(stopped).toContainText("Stopped: Blocked: Needs the staging key");
    await expect(card.getByText("Ship pricing page")).toHaveCount(0);
    await expect(page.getByText(/1 thing waiting on you/)).toBeVisible();
    await stopped.getByRole("button", { name: "Open" }).click();
    await expect(page.getByRole("dialog", { name: /Fix login/ })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.evaluate(async ({ orgId, id }) => {
      const api = (window as unknown as { agentCompany: Record<string, (input: unknown) => Promise<unknown>> }).agentCompany;
      await api.setTaskBlocked({ orgId, taskId: id, reason: null });
    }, blocked);
    await page.getByRole("button", { name: "Home" }).click();
    await expect(card.getByText("You're all caught up")).toBeVisible();
    // With nothing waiting, the most urgent open task is next.
    await expect(card.getByText("Next in line")).toBeVisible();
    await expect(card.getByText("Fix login")).toBeVisible();
    await expect(card.getByText("Ship pricing page")).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});
