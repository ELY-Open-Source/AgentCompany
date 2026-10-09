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

    // A send the backend refuses keeps the draft and says why, instead of clearing it.
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("/nosuch keep this draft");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("alert")).toContainText("Not sent: Slash command /nosuch is unavailable.");
    await expect(composer).toHaveValue("/nosuch keep this draft");
    await composer.fill("Second thought: what is blocked?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(chatLog.getByText("Second thought: what is blocked?")).toBeVisible();
    await expect(composer).toHaveValue("");
    await expect(page.getByRole("alert")).toHaveCount(0);

    // Each conversation keeps its own unsent draft.
    await composer.fill("Draft for the CEO only");
    await page.locator(".convo-item", { hasText: "general" }).click();
    await expect(composer).toHaveValue("");
    await composer.fill("Draft for general");
    await page.locator(".convo-item").first().click();
    await expect(composer).toHaveValue("Draft for the CEO only");
    await page.locator(".convo-item", { hasText: "general" }).click();
    await expect(composer).toHaveValue("Draft for general");

    // A reply goes into the thread of the message it answers, and the timeline says what it answers.
    await page.locator(".convo-item").first().click();
    const root = chatLog.locator(".chat-message", { hasText: "How are we tracking against the goal?" }).first();
    await root.getByRole("button", { name: "Reply in thread" }).click();
    const thread = page.getByRole("complementary", { name: "Thread" });
    await expect(thread).toContainText("How are we tracking against the goal?");
    await thread.getByRole("textbox", { name: "Reply" }).fill("Also: which task is late?");
    await thread.getByRole("button", { name: "Send reply" }).click();
    await expect(thread.locator(".chat-message", { hasText: "Also: which task is late?" })).toBeVisible();
    const reply = chatLog.locator(".chat-message", { hasText: "Also: which task is late?" });
    await expect(reply.getByRole("button", { name: /^Replying to Yang/ })).toContainText("How are we tracking against the goal?");
    await expect(root).toContainText("1 reply");
    await thread.getByRole("button", { name: "Close thread" }).click();
    await expect(thread).toHaveCount(0);

    // A message that arrives while the reader is up in history stays unread until they scroll down to it.
    await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: {
        loadSnapshot: () => Promise<{ ok: true; data: { activeOrgId: string; employees: Array<{ id: string; orgId: string }>; chatSpaces: Array<{ id: string; orgId: string; spaceType: string }> } }>;
        sendMessage: (input: unknown) => Promise<unknown>;
      } }).agentCompany;
      const snapshot = (await api.loadSnapshot()).data;
      const employee = snapshot.employees.find((item) => item.orgId === snapshot.activeOrgId)!;
      const ceoChat = snapshot.chatSpaces.find((item) => item.orgId === snapshot.activeOrgId && item.spaceType === "direct")!;
      for (let index = 0; index < 40; index += 1) {
        await api.sendMessage({ orgId: snapshot.activeOrgId, spaceId: ceoChat.id, threadId: null, senderType: "employee", senderId: employee.id, bodyMd: `History line ${index}`, attachmentFileIds: [] });
      }
    });
    await expect(chatLog.getByText("History line 39")).toBeVisible();
    await chatLog.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll"));
    });
    await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: {
        loadSnapshot: () => Promise<{ ok: true; data: { activeOrgId: string; agents: Array<{ id: string; orgId: string; roleLevel: string }>; chatSpaces: Array<{ id: string; orgId: string; spaceType: string }> } }>;
        sendMessage: (input: unknown) => Promise<unknown>;
      } }).agentCompany;
      const snapshot = (await api.loadSnapshot()).data;
      const ceo = snapshot.agents.find((agent) => agent.orgId === snapshot.activeOrgId && agent.roleLevel === "c_suite")!;
      const ceoChat = snapshot.chatSpaces.find((item) => item.orgId === snapshot.activeOrgId && item.spaceType === "direct")!;
      await api.sendMessage({ orgId: snapshot.activeOrgId, spaceId: ceoChat.id, threadId: null, senderType: "agent", senderId: ceo.id, bodyMd: "An update you have not seen yet.", attachmentFileIds: [] });
    });
    const ceoRow = page.locator(".convo-item").first();
    await expect(ceoRow.locator(".nav-badge")).toHaveText("1");
    await page.getByRole("button", { name: "Jump to latest" }).click();
    await expect(ceoRow.locator(".nav-badge")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
