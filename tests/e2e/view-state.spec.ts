import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";
import { closeApp, onboard } from "./onboard";

test("the page, its section and its view survive page switches and a restart", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-view-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-view-builtin-${randomUUID()}`));
  const launch = () => electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });

  let app = await launch();
  let page = await app.firstWindow();
  await onboard(page, "View Co");
  await page.getByRole("button", { name: "Work" }).click();
  await page.locator(".segment", { hasText: "List" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Providers" }).click();
  // Coming back to a page returns to where it was left.
  await page.getByRole("button", { name: "Work" }).click();
  await expect(page.locator(".segment.active")).toHaveText("List");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("button", { name: "Providers" })).toHaveClass(/active/);
  // A link to a workspace still lands on General, where the workspace is shown.
  const folder = join(tmpdir(), `agentcompany-new-e2e-view-ws-${randomUUID()}`);
  mkdirSync(folder, { recursive: true });
  await page.evaluate(async (localPath) => {
    const api = (window as unknown as { agentCompany: {
      loadSnapshot: () => Promise<{ ok: true; data: { activeOrgId: string; workspaces: Array<{ id: string; name: string }> } }>;
      createWorkspace: (input: unknown) => Promise<{ ok: boolean }>;
      createTask: (input: unknown) => Promise<{ ok: boolean }>;
    } }).agentCompany;
    const orgId = (await api.loadSnapshot()).data.activeOrgId;
    await api.createWorkspace({ orgId, name: "Linked repo", localPath, projectId: null });
    const workspaceId = (await api.loadSnapshot()).data.workspaces.find((workspace) => workspace.name === "Linked repo")!.id;
    await api.createTask({
      orgId, title: "Uses the linked repo", description: "d", status: "backlog", assigneeAgentId: null, risk: "low",
      projectId: null, goalId: null, workspaceId, priority: "normal", requiresFilesystem: false,
    });
  }, folder);
  await page.getByRole("button", { name: "Work" }).click();
  await page.getByRole("button", { name: /Uses the linked repo/ }).first().click();
  await page.getByRole("button", { name: "Open workspace Linked repo" }).click();
  await expect(page.getByRole("button", { name: "General" })).toHaveClass(/active/);
  await expect(page.getByRole("group", { name: "Linked repo" })).toBeVisible();
  await page.getByRole("button", { name: "Providers" }).click();
  await expect.poll(() => page.evaluate(async () => {
    const api = (window as unknown as { agentCompany: { loadSnapshot: () => Promise<{ ok: true; data: { viewState: Record<string, unknown> } }> } }).agentCompany;
    return (await api.loadSnapshot()).data.viewState.route;
  })).toBe("settings");
  await closeApp(app);

  // A restart opens the same page and section, and the view the work was left in.
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByRole("button", { name: "Providers" })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Work" }).click();
  await expect(page.locator(".segment.active")).toHaveText("List");
  await closeApp(app);
});
