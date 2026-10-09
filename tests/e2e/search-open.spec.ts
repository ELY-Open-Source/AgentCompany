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
