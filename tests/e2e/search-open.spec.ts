import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";
import { closeApp, onboard } from "./onboard";

test("a search hit opens the object itself, not just its page", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-search-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-search-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: { ...process.env, AGENTCOMPANY_NEW_PROFILE_DIR: profileDir, AGENTCOMPANY_NEW_AUTORUN: "0", AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir },
  });
  try {
    const page = await app.firstWindow();
    await onboard(page, "Search Co");
    await page.getByRole("button", { name: "Messages" }).click();
    await page.getByText("general").first().click();
    await page.getByRole("textbox", { name: "Message" }).fill("zebra crossing note");
    await page.getByRole("button", { name: "Send" }).click();
    await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: {
        loadSnapshot: () => Promise<{ ok: true; data: { activeOrgId: string } }>;
        createDocument: (input: unknown) => Promise<{ ok: boolean }>;
      } }).agentCompany;
      const orgId = (await api.loadSnapshot()).data.activeOrgId;
      await api.createDocument({ orgId, title: "Walrus pricing memo", docType: "memo", content: "Tiers.", authorAgentId: null, reviewerAgentId: null, projectId: null, goalId: null, taskId: null });
    });
    await page.getByRole("button", { name: "Home" }).click();

    const search = async (query: string, title: RegExp) => {
      await page.locator(".search-kbd").click();
      await page.getByRole("dialog", { name: "Search" }).getByRole("textbox").fill(query);
      await page.getByRole("dialog", { name: "Search" }).getByRole("button", { name: title }).first().click();
    };

    // While asking, search says so; quick typing shows only the latest words' answer.
    await page.locator(".search-kbd").click();
    const searchDialog = page.getByRole("dialog", { name: "Search" });
    await searchDialog.getByRole("textbox").fill("zebra");
    await expect(searchDialog.getByRole("status")).toHaveText("Searching…");
    await searchDialog.getByRole("textbox").fill("Walrus");
    await expect(searchDialog.getByRole("button", { name: /Walrus pricing memo/ })).toBeVisible();
    await expect(searchDialog.getByRole("button", { name: /zebra crossing note/ })).toHaveCount(0);
    await expect(searchDialog.getByText("Searching…")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Search says how many match, pages through the rest, and says when nothing matches.
    await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: {
        loadSnapshot: () => Promise<{ ok: true; data: { activeOrgId: string } }>;
        createTask: (input: unknown) => Promise<{ ok: boolean }>;
      } }).agentCompany;
      const orgId = (await api.loadSnapshot()).data.activeOrgId;
      for (let index = 0; index < 15; index += 1) {
        await api.createTask({
          orgId, title: `Lantern check ${index}`, description: "d", status: "backlog", assigneeAgentId: null, risk: "low",
          projectId: null, goalId: null, workspaceId: null, priority: "normal", requiresFilesystem: false,
        });
      }
    });
    await page.locator(".search-kbd").click();
    await searchDialog.getByRole("textbox").fill("lantern");
    await expect(searchDialog.getByText("Showing 12 of 15")).toBeVisible();
    await searchDialog.getByRole("button", { name: "Show more" }).click();
    await expect(searchDialog.getByText("Showing 15 of 15")).toBeVisible();
    await expect(searchDialog.getByRole("button", { name: /Lantern check/ })).toHaveCount(15);
    await expect(searchDialog.getByRole("button", { name: "Show more" })).toHaveCount(0);
    await searchDialog.getByRole("textbox").fill("qqzzxx");
    await expect(searchDialog.getByText("Nothing matches “qqzzxx”.")).toBeVisible();
    await page.keyboard.press("Escape");

    // A message opens its conversation with its thread shown and the message marked.
    await search("zebra", /zebra crossing note/);
    await expect(page.getByRole("complementary", { name: "Thread" })).toBeVisible();
    await expect(page.locator("[data-revealed=true]").first()).toContainText("zebra crossing note");

    // A task opens its detail.
    await search("Operationalize", /Operationalize goal/);
    await expect(page.getByRole("dialog", { name: /Operationalize goal/ })).toBeVisible();
    await page.getByRole("dialog", { name: /Operationalize goal/ }).getByRole("button", { name: "Close" }).click();

    // A document opens in the library, selected and marked.
    await search("Walrus", /Walrus pricing memo/);
    await expect(page.locator("[data-revealed=true]")).toContainText("Walrus pricing memo");
    await expect(page.getByRole("heading", { name: "Walrus pricing memo" })).toBeVisible();
  } finally {
    await closeApp(app);
  }
});
