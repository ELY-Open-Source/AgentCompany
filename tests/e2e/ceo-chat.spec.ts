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
    // The message itself says where the reply stands.
    await expect(chatLog.locator(".chat-message", { hasText: "How are we tracking against the goal?" }).first()).toContainText("CEO will reply; queued.");

    // From a task, its goal, run and back are one click each.
    await page.getByRole("button", { name: "Work" }).click();
    // The CEO's reply to the founder is a chat vehicle, not work: it stays off the board.
    await expect(page.getByRole("button", { name: /Reply to Yang/ })).toHaveCount(0);
    await page.getByRole("button", { name: /Operationalize goal: Ship the FlowPilot MVP\./ }).first().click();
    const taskDialog = page.getByRole("dialog", { name: "Operationalize goal: Ship the FlowPilot MVP." });
    await taskDialog.getByRole("button", { name: "Open goal Ship the FlowPilot MVP." }).click();
    await expect(page.getByText("Goal: Ship the FlowPilot MVP.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Operationalize goal: Ship the FlowPilot MVP\./ }).first().click();
    await taskDialog.getByRole("button", { name: /^Open run/ }).first().click();
    await expect(page.getByRole("button", { name: "Open task Operationalize goal: Ship the FlowPilot MVP." })).toBeVisible();
    await page.getByRole("button", { name: "Open task Operationalize goal: Ship the FlowPilot MVP." }).click();
    await expect(taskDialog).toBeVisible();
    // A wrong link is corrected in the same task's editor, as at creation.
    await taskDialog.getByRole("button", { name: "Edit" }).click();
    await taskDialog.getByLabel("Writing").selectOption("technical");
    await taskDialog.getByLabel("Requires workspace access").check();
    await taskDialog.getByRole("button", { name: "Save" }).click();
    await expect(taskDialog.getByRole("heading", { name: "Edit task" })).toHaveCount(0);
    const edited = await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: { loadSnapshot: () => Promise<{ ok: true; data: { tasks: Array<{ title: string; writingMode: string; requiresFilesystem: boolean }> } }> } }).agentCompany;
      const task = (await api.loadSnapshot()).data.tasks.find((item) => item.title === "Operationalize goal: Ship the FlowPilot MVP.")!;
      return [task.writingMode, task.requiresFilesystem];
    });
    expect(edited).toEqual(["technical", true]);
    // A pending request opens for review: read it in full and decide with notes; nothing there pretends to edit it.
    await taskDialog.getByRole("button", { name: "Close" }).click();
    await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: {
        loadSnapshot: () => Promise<{ ok: true; data: { activeOrgId: string } }>;
        createApproval: (input: unknown) => Promise<{ ok: boolean }>;
      } }).agentCompany;
      const orgId = (await api.loadSnapshot()).data.activeOrgId;
      await api.createApproval({ orgId, kind: "budget_increase", title: "Raise the ads budget", details: "From $200 to $500.", risk: "medium", requestedByType: "system", requestedById: null });
    });
    await page.getByRole("button", { name: "Approvals" }).click();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Review" }).first().click();
    const review = page.getByRole("dialog", { name: "Raise the ads budget" });
    await expect(review.getByRole("textbox", { name: "Decision notes" })).toBeVisible();
    // Notes belong to one request: closing or switching never carries them to the next.
    await review.getByRole("textbox", { name: "Decision notes" }).fill("Only for the ads budget.");
    await review.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Review" }).first().click();
    await expect(review.getByRole("textbox", { name: "Decision notes" })).toHaveValue("");
    await review.getByRole("button", { name: "Close" }).click();
    // A batch approval says how far it got, item by item.
    await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: {
        loadSnapshot: () => Promise<{ ok: true; data: { activeOrgId: string } }>;
        createApproval: (input: unknown) => Promise<{ ok: boolean }>;
      } }).agentCompany;
      const orgId = (await api.loadSnapshot()).data.activeOrgId;
      for (const title of ["Order stickers", "Renew the domain"]) {
        await api.createApproval({ orgId, kind: "purchase", title, details: "Small spend.", risk: "low", requestedByType: "system", requestedById: null });
      }
    });
    await expect(page.getByText("Renew the domain")).toBeVisible();
    await page.getByRole("button", { name: "Approve all low risk" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Approved" })).toContainText("Approved 2 of 2.");
    // A decided request can be reopened in full: what was asked, the notes, who decided and when.
    await page.getByRole("button", { name: "View record of Order stickers" }).click();
    const record = page.getByRole("dialog", { name: "Record of Order stickers" });
    await expect(record).toContainText("Small spend.");
    await expect(record).toContainText("No notes");
    await expect(record).toContainText("Yang");
    await record.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Work" }).click();
    await page.getByRole("button", { name: /Operationalize goal: Ship the FlowPilot MVP\./ }).first().click();
    // Blocking says why on the task and stops it; work can also move backwards.
    await taskDialog.getByRole("button", { name: "Block", exact: true }).click();
    await taskDialog.getByRole("textbox", { name: "Why is it blocked?" }).fill("Waiting for the legal review.");
    await taskDialog.getByRole("button", { name: "Block task" }).click();
    await expect(taskDialog.getByRole("status")).toContainText("Blocked: Waiting for the legal review.");
    await taskDialog.getByRole("button", { name: "Unblock" }).click();
    await expect(taskDialog.getByText("Blocked: Waiting for the legal review.")).toHaveCount(0);
    await taskDialog.getByRole("button", { name: "In progress" }).click();
    await taskDialog.getByRole("button", { name: "Back to backlog" }).click();
    await expect(taskDialog.getByRole("button", { name: "In progress" })).toBeVisible();
    await taskDialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Messages" }).click();

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

    // An edit the backend refuses keeps the editor open with the text and says why.
    const own = chatLog.locator(".chat-message", { hasText: "Second thought: what is blocked?" });
    await own.getByRole("button", { name: "Edit message" }).click();
    const editor = own.getByRole("textbox", { name: "Edit message" });
    await editor.fill("/status everything");
    await own.getByRole("button", { name: "Save" }).click();
    await expect(own.getByRole("alert")).toContainText("Not saved: Slash command messages are immutable.");
    await expect(editor).toHaveValue("/status everything");
    await editor.fill("Second thought: what is blocked right now?");
    await own.getByRole("button", { name: "Save" }).click();
    await expect(chatLog.getByText("Second thought: what is blocked right now?")).toBeVisible();
    await expect(chatLog.getByRole("textbox", { name: "Edit message" })).toHaveCount(0);

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

    // History older than the loaded window comes from the database, back to the very first message.
    await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: {
        loadSnapshot: () => Promise<{ ok: true; data: { activeOrgId: string; employees: Array<{ id: string; orgId: string }>; chatSpaces: Array<{ id: string; orgId: string; name: string }> } }>;
        sendMessage: (input: unknown) => Promise<unknown>;
      } }).agentCompany;
      const snapshot = (await api.loadSnapshot()).data;
      const employee = snapshot.employees.find((item) => item.orgId === snapshot.activeOrgId)!;
      const general = snapshot.chatSpaces.find((item) => item.orgId === snapshot.activeOrgId && item.name === "general")!;
      for (let index = 0; index < 520; index += 1) {
        await api.sendMessage({ orgId: snapshot.activeOrgId, spaceId: general.id, threadId: null, senderType: "employee", senderId: employee.id, bodyMd: `General line ${index}`, attachmentFileIds: [] });
      }
    });
    await page.locator(".convo-item", { hasText: "general" }).click();
    await expect(chatLog.getByText("General line 519")).toBeVisible();
    const start = chatLog.getByText("This is the start of the conversation.");
    for (let click = 0; click < 10 && !(await start.isVisible()); click += 1) {
      await chatLog.getByRole("button", { name: "Show earlier messages" }).click();
      await page.waitForTimeout(300);
    }
    await expect(start).toBeVisible();
    await expect(chatLog.getByText("General line 0", { exact: true })).toBeVisible();

    // The header lists the real members, how each agent replies, and who can read.
    await page.getByRole("button", { name: /^Members \(/ }).click();
    const roster = page.getByRole("menu");
    await expect(roster).toContainText("Everyone in the company can read this channel.");
    await expect(roster.locator(".members-roster")).toHaveCSS("overflow-y", "auto");
    await expect(roster).toContainText("Replies when @mentioned, in threads it joined, and to messages that name no one");
    await page.keyboard.press("Escape");
    await page.locator(".convo-item").first().click();
    await page.getByRole("button", { name: /^Members \(/ }).click();
    await expect(page.getByRole("menu")).toContainText("Replies to every message");
    await page.keyboard.press("Escape");

    // Deleting a task first says what it takes with it, then waits for the result.
    await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: {
        loadSnapshot: () => Promise<{ ok: true; data: { activeOrgId: string; tasks: Array<{ id: string; title: string }> } }>;
        createTask: (input: unknown) => Promise<{ ok: boolean }>;
        updateTask: (input: unknown) => Promise<{ ok: boolean }>;
      } }).agentCompany;
      const before = (await api.loadSnapshot()).data;
      const parent = before.tasks.find((task) => task.title === "Operationalize goal: Ship the FlowPilot MVP.")!;
      await api.createTask({
        orgId: before.activeOrgId, title: "Child step", description: "d", status: "backlog", assigneeAgentId: null, risk: "low",
        projectId: null, goalId: null, workspaceId: null, priority: "normal", requiresFilesystem: false,
      });
      const child = (await api.loadSnapshot()).data.tasks.find((task) => task.title === "Child step")!;
      await api.updateTask({
        orgId: before.activeOrgId, taskId: child.id, title: "Child step", description: "d", assigneeAgentId: null, risk: "low", priority: "normal",
        parentTaskId: parent.id, projectId: null, goalId: null, workspaceId: null, requiresFilesystem: false, writingMode: "conversational",
      });
    });
    await page.getByRole("button", { name: "Work" }).click();
    await page.getByRole("button", { name: /Operationalize goal: Ship the FlowPilot MVP\./ }).first().click();
    const parentDialog = page.getByRole("dialog", { name: "Operationalize goal: Ship the FlowPilot MVP." });
    await parentDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(parentDialog.getByRole("alertdialog", { name: "Delete this task?" })).toContainText("1 subtasks stay and move to the top level.");
    // Switching to another task drops a pending confirmation, so it can never delete the wrong task.
    await parentDialog.getByRole("button", { name: "Subtasks" }).click();
    await parentDialog.getByRole("button", { name: "Open task Child step" }).click();
    const childDialog = page.getByRole("dialog", { name: "Child step" });
    await expect(childDialog).toBeVisible();
    await expect(childDialog.getByRole("alertdialog")).toHaveCount(0);
    await childDialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: /Operationalize goal: Ship the FlowPilot MVP\./ }).first().click();
    const doomed = page.getByRole("dialog", { name: "Operationalize goal: Ship the FlowPilot MVP." });
    await doomed.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = doomed.getByRole("alertdialog", { name: "Delete this task?" });
    await expect(confirm).toContainText("sessions and their action records are deleted.");
    await confirm.getByRole("button", { name: "Delete task" }).click();
    await expect(doomed).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Operationalize goal: Ship the FlowPilot MVP\./ })).toHaveCount(0);
  } finally {
    await app.close();
  }
});
