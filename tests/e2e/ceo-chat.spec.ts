import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";

/**
 * The founder's direct line to the CEO: onboarding leaves a pinned CEO
 * conversation at the top of Messages, the page opens on it, a founder
 * message lands there and queues a CEO wake run, and no amount of channel
 * recency displaces the pin.
 */
test("the pinned CEO conversation is the Messages front door", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-ceo-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const builtinDir = seedBuiltinSkillsFixture(join(tmpdir(), `agentcompany-new-e2e-ceo-builtin-${randomUUID()}`));
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: {
      ...process.env,
      AGENTCOMPANY_NEW_PROFILE_DIR: profileDir,
      AGENTCOMPANY_NEW_AUTORUN: "0",
      AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: builtinDir,
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("button", { name: /^OpenAI API key/ }).click();
    await page.getByLabel("API key").fill("e2e-secret");
    await page.getByLabel("Model").fill("gpt-5.4");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Company name").fill("FlowPilot");
    await page.getByLabel("Your name").fill("Yang");
    await page.getByLabel("Description").fill("A CSM analytics product for SMBs.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Goal").fill("Ship the FlowPilot MVP.");
    await page.getByLabel("Acceptance criteria").fill("A working product, not documents about one.");
    await page.getByRole("button", { name: "Launch" }).click();
    await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
    await page.getByRole("button", { name: "Finish" }).click();

    // The CEO conversation is the first row, badged, and already selected —
    // opening Messages IS opening the CEO chat.
    await page.getByRole("button", { name: "Messages" }).click();
    const firstRow = page.locator(".convo-item").first();
    await expect(firstRow).toContainText("CEO");
    await expect(firstRow.locator(".convo-ceo-badge")).toBeVisible();
    await expect(firstRow).toHaveClass(/active/);
    await expect(firstRow).toContainText("Ask about progress, goals, or direction");

    // A founder message lands in the conversation and queues the CEO's wake
    // run — the reply pipeline is armed even with autonomous execution off.
    await page.getByRole("textbox", { name: "Message" }).fill("How are we tracking against the goal?");
    await page.getByRole("button", { name: "Send" }).click();
    const chatLog = page.getByRole("log", { name: "Conversation messages" });
    await expect(chatLog.getByText("How are we tracking against the goal?")).toBeVisible();
    const wake = await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: { loadSnapshot: () => Promise<{ ok: true; data: {
        agents: Array<{ id: string; roleLevel: string }>;
        taskRuns: Array<{ agentId: string | null; trigger: string; state: string }>;
      } }> } }).agentCompany;
      const snapshot = await api.loadSnapshot();
      const ceo = snapshot.data.agents.find((agent) => agent.roleLevel === "c_suite")!;
      return snapshot.data.taskRuns.filter((run) => run.agentId === ceo.id && run.trigger === "chat_mention").map((run) => run.state);
    });
    expect(wake).toEqual(["queued"]);

    // Recency pressure: newer traffic in a channel must not displace the pin.
    await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: {
        loadSnapshot: () => Promise<{ ok: true; data: {
          activeOrgId: string;
          employees: Array<{ id: string; orgId: string }>;
          chatSpaces: Array<{ id: string; orgId: string; name: string }>;
        } }>;
        sendMessage: (input: unknown) => Promise<unknown>;
      } }).agentCompany;
      const snapshot = await api.loadSnapshot();
      const orgId = snapshot.data.activeOrgId;
      const employee = snapshot.data.employees.find((item) => item.orgId === orgId)!;
      const general = snapshot.data.chatSpaces.find((item) => item.orgId === orgId && item.name === "general")!;
      await api.sendMessage({
        orgId,
        spaceId: general.id,
        threadId: null,
        senderType: "employee",
        senderId: employee.id,
        bodyMd: "Channel chatter arriving after the founder's CEO message.",
        attachmentFileIds: [],
      });
    });
    await expect(page.locator(".convo-item").first().locator(".convo-ceo-badge")).toBeVisible();
    await expect(page.locator(".convo-item").first()).toContainText("How are we tracking against the goal?");
  } finally {
    await app.close();
  }
});
