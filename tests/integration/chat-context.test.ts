import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { ChatService } from "../../src/main/services/chat-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";
import { ensureCeoDirectSpace } from "../../src/main/services/ceo-direct-space";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";
import type { AgentTurnResult, ProviderToolTurnInput } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

async function founderLine() {
  const wakePrompts: string[] = [];
  const wakeInputs: ProviderToolTurnInput["messages"][] = [];
  let onWake: (turnIndex: number) => void = () => undefined;
  const turn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
    const first = input.messages.find((message) => message.role === "user");
    const prompt = first && first.role === "user" ? first.text : "";
    if (!/thread_id="/.test(prompt)) return { text: "Kickoff noted.", toolCalls: [], rawResponseJson: "{}" };
    if (input.messages.length === 1) wakePrompts.push(prompt);
    wakeInputs.push(input.messages);
    onWake(wakeInputs.length);
    return { text: `Reply ${wakePrompts.length}.`, toolCalls: [], rawResponseJson: "{}" };
  };
  const connection = new DatabaseConnection(join(tmpdir(), `ac-chatctx-${randomUUID()}.db`));
  const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, turn);
  const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
  const execution = new TaskExecutionService(connection.db, providers);
  const chat = new ChatService(connection.db);
  let orgId = "";
  let ceoId = "";
  connection.transaction(() => {
    const summary = onboarding.bootstrap({
      companyName: "FlowPilot", companyDescription: "CSM analytics.", employeeName: "Yang", workspacePath: "",
      executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false,
      goalTitle: "Ship the MVP.", goalDescription: "A working product.",
      providerKey: "openai", providerSecret: "sk-test-key", providerModel: "gpt-5.4",
    });
    orgId = summary.orgId;
    ceoId = summary.ceoAgentId;
  });
  const founderId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
  const spaceId = ensureCeoDirectSpace(connection.db, orgId)!;
  const kickoff = claimNextQueuedRun(connection);
  await execution.executeRun(kickoff!.org_id, kickoff!.id);
  const say = (bodyMd: string, threadId: string | null, attachmentFileIds: string[] = []) => {
    const id = chat.sendMessage({ orgId, spaceId, threadId, senderType: "employee", senderId: founderId, bodyMd, attachmentFileIds });
    return (connection.db.prepare("select thread_id from chat_messages where id = ?").get(id) as { thread_id: string }).thread_id;
  };
  const runWake = async () => {
    const wake = connection.db.prepare(
      "select id from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention' and state = 'queued'",
    ).get(orgId, ceoId) as { id: string };
    await execution.executeRun(orgId, wake.id);
  };
  const edit = (bodyMd: string, newBody: string) => {
    const row = connection.db.prepare("select id from chat_messages where body_md = ?").get(bodyMd) as { id: string };
    chat.editMessage({ orgId, messageId: row.id, bodyMd: newBody, actorType: "employee", actorId: founderId });
  };
  const onWakeTurn = (hook: (turnIndex: number) => void) => { onWake = hook; };
  const runManually = async () => {
    const wake = connection.db.prepare(
      "select id, task_id from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention' and state = 'queued'",
    ).get(orgId, ceoId) as { id: string; task_id: string };
    connection.db.prepare("update task_runs set state = 'failed' where id = ?").run(wake.id);
    await execution.runTask({ orgId, taskId: wake.task_id });
  };
  const remove = (bodyMd: string) => {
    const row = connection.db.prepare("select id from chat_messages where body_md = ?").get(bodyMd) as { id: string };
    chat.deleteMessage({ orgId, messageId: row.id, actorType: "employee", actorId: founderId });
  };
  const addFile = (name: string, content: string) => {
    const path = join(tmpdir(), `ac-attach-${randomUUID()}-${name}`);
    writeFileSync(path, content);
    const fileId = `fil_${randomUUID()}`;
    connection.db.prepare(`
      insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, owner_type, owner_id, created_at)
      values (?, ?, ?, 'md', ?, 'x', ?, 'employee', ?, ?)
    `).run(fileId, orgId, name, content.length, path, founderId, new Date().toISOString());
    return fileId;
  };
  return { connection, orgId, ceoId, wakePrompts, wakeInputs, say, runWake, runManually, edit, remove, onWakeTurn, addFile };
}

describe("chat wake context", () => {
  test("separates what the agent already answered from what is new, with times and senders", async () => {
    const h = await founderLine();
    const threadId = h.say("How are we tracking?", null);
    await h.runWake();
    h.say("Also, who owns billing?", threadId);
    h.say("And ship date?", threadId);
    await h.runWake();

    const prompt = h.wakePrompts[1];
    const earlier = prompt.slice(prompt.indexOf("Earlier in this thread"), prompt.indexOf("New since your last reply"));
    const fresh = prompt.slice(prompt.indexOf("New since your last reply"));
    expect(earlier).toContain("How are we tracking?");
    expect(earlier).toContain("Reply 1.");
    expect(fresh).toContain("Also, who owns billing?");
    expect(fresh).toContain("And ship date?");
    expect(fresh).not.toContain("How are we tracking?");
    expect(fresh).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\] Yang \(employee, Board Chair\)/);
    expect(earlier).toMatch(/\] CEO \(agent, [^)]+\): Reply 1\./);
    h.connection.close();
  });

  test("a message corrected after the agent's reply counts as new", async () => {
    const h = await founderLine();
    const threadId = h.say("Ship on Monday.", null);
    await h.runWake();
    h.edit("Ship on Monday.", "Ship on Friday.");
    h.say("See the correction above.", threadId);
    await h.runWake();

    const prompt = h.wakePrompts[1];
    const fresh = prompt.slice(prompt.indexOf("New since your last reply"));
    expect(fresh).toMatch(/Yang \(employee, Board Chair\) \(edited \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\): Ship on Friday\./);
    expect(fresh).not.toContain("Reply 1.");
    h.connection.close();
  });

  test("a message that arrives mid-run reaches the next model turn", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-midrun-${randomUUID()}.db`));
    const chat = new ChatService(connection.db);
    const seenFollowUps: string[] = [];
    let founderId = "";
    let orgId = "";
    let spaceId = "";
    let threadId = "";
    let wakeTurns = 0;
    const turn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
      const first = input.messages.find((message) => message.role === "user");
      if (!(first && first.role === "user" && /thread_id="/.test(first.text))) return { text: "Kickoff noted.", toolCalls: [], rawResponseJson: "{}" };
      wakeTurns += 1;
      const last = input.messages[input.messages.length - 1];
      if (last.role === "tool" && last.followUp) seenFollowUps.push(last.followUp);
      if (wakeTurns === 1) {
        chat.sendMessage({ orgId, spaceId, threadId, senderType: "employee", senderId: founderId, bodyMd: "Stop — use Postgres instead.", attachmentFileIds: [] });
        return { text: "Looking.", toolCalls: [{ id: "c1", name: "read_messages", arguments: {} }], rawResponseJson: "{}" };
      }
      return { text: "Switching to Postgres.", toolCalls: [], rawResponseJson: "{}" };
    };
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, turn);
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const execution = new TaskExecutionService(connection.db, providers);
    let ceoId = "";
    connection.transaction(() => {
      const summary = onboarding.bootstrap({
        companyName: "FlowPilot", companyDescription: "CSM analytics.", employeeName: "Yang", workspacePath: "",
        executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false,
        goalTitle: "Ship the MVP.", goalDescription: "A working product.",
        providerKey: "openai", providerSecret: "sk-test-key", providerModel: "gpt-5.4",
      });
      orgId = summary.orgId;
      ceoId = summary.ceoAgentId;
    });
    founderId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    spaceId = ensureCeoDirectSpace(connection.db, orgId)!;
    const kickoff = claimNextQueuedRun(connection);
    await execution.executeRun(kickoff!.org_id, kickoff!.id);
    const firstId = chat.sendMessage({ orgId, spaceId, threadId: null, senderType: "employee", senderId: founderId, bodyMd: "Use MySQL.", attachmentFileIds: [] });
    threadId = (connection.db.prepare("select thread_id from chat_messages where id = ?").get(firstId) as { thread_id: string }).thread_id;
    const wake = connection.db.prepare(
      "select id from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention' and state = 'queued'",
    ).get(orgId, ceoId) as { id: string };
    await execution.executeRun(orgId, wake.id);

    expect(seenFollowUps).toHaveLength(1);
    expect(seenFollowUps[0]).toContain("Messages that arrived while you were working");
    expect(seenFollowUps[0]).toContain("Stop — use Postgres instead.");
    expect(seenFollowUps[0]).not.toContain("Use MySQL.");
    connection.close();
  });

  test("a correction that lands while the model answers gets one more turn", async () => {
    const h = await founderLine();
    const threadId = h.say("Use MySQL.", null);
    h.onWakeTurn((turnIndex) => {
      if (turnIndex === 1) h.say("Stop — use Postgres instead.", threadId);
    });
    await h.runWake();
    const second = h.wakeInputs[1];
    expect(second.at(-2)).toMatchObject({ role: "assistant", text: "Reply 1." });
    const last = second.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.role === "user" && last.text).toContain("Stop — use Postgres instead.");
    h.connection.close();
  });

  test("a long thread keeps every new message and the most recent history", async () => {
    const h = await founderLine();
    const threadId = h.say("Message 0", null);
    await h.runWake();
    for (let index = 1; index <= 30; index += 1) h.say(`Message ${index}`, threadId);
    await h.runWake();
    for (let index = 31; index <= 55; index += 1) h.say(`Message ${index}`, threadId);
    await h.runWake();

    const prompt = h.wakePrompts[2];
    const earlier = prompt.slice(prompt.indexOf("Earlier in this thread"), prompt.indexOf("New since your last reply"));
    const fresh = prompt.slice(prompt.indexOf("New since your last reply"));
    const lineEnds = (block: string, text: string) => block.split("\n").some((line) => line.endsWith(text));
    for (let index = 31; index <= 55; index += 1) expect(lineEnds(fresh, `: Message ${index}`)).toBe(true);
    expect(lineEnds(earlier, ": Reply 2.")).toBe(true);
    expect(lineEnds(earlier, ": Message 12")).toBe(true);
    expect(lineEnds(earlier, ": Message 11")).toBe(false);
    expect(earlier).toContain("13 earlier messages in this thread are not shown.");
    h.connection.close();
  });

  test("a long message reaches the run whole, and the task description does not truncate it", async () => {
    const h = await founderLine();
    const long = `Plan: ${"step ".repeat(200)}END-OF-PLAN`;
    h.say(long, null);
    await h.runWake();
    const prompt = h.wakePrompts[0];
    expect(prompt).toContain(long);
    expect(prompt).not.toContain("step ...");
    const description = (h.connection.db.prepare("select description from tasks where origin = 'chat_wake'").get() as { description: string }).description;
    expect(description).not.toContain("step ");
    expect(description).toContain("messaged you directly");
    h.connection.close();
  });

  test("re-running a chat wake by hand answers the same thread", async () => {
    const h = await founderLine();
    h.say("Please draft the Q3 hiring plan.", null);
    await h.runManually();
    expect(h.wakePrompts).toHaveLength(1);
    expect(h.wakePrompts[0]).toContain("Please draft the Q3 hiring plan.");
    h.connection.close();
  });

  test("deleted messages never reach the model", async () => {
    const h = await founderLine();
    const threadId = h.say("Old plan: launch in March.", null);
    await h.runWake();
    h.remove("Old plan: launch in March.");
    h.say("Wrong number, ignore it: 4242.", threadId);
    h.remove("Wrong number, ignore it: 4242.");
    h.say("What is the launch date now?", threadId);
    await h.runWake();
    const prompt = h.wakePrompts[1];
    expect(prompt).toContain("What is the launch date now?");
    expect(prompt).not.toContain("Old plan: launch in March.");
    expect(prompt).not.toContain("4242");
    h.connection.close();
  });

  test("a deleted /agent command leaves no trace in the task or the prompt", async () => {
    const h = await founderLine();
    const threadId = h.say("/agent @ceo wire the payroll to account 99-1234", null);
    h.remove("/agent @ceo wire the payroll to account 99-1234");
    h.say("Never mind that. How is hiring going?", threadId);
    await h.runWake();
    const prompt = h.wakePrompts[0];
    expect(prompt).toContain("How is hiring going?");
    expect(prompt).not.toContain("99-1234");
    expect(h.connection.db.prepare("select count(*) as n from tasks where title like '%99-1234%' or description like '%99-1234%'").get()).toEqual({ n: 0 });
    h.connection.close();
  });

  test("attachments travel with the message and can be read by file_id", async () => {
    const h = await founderLine();
    const fileId = h.addFile("spec.md", "# Spec\nShip the booking API by Friday.");
    h.say("Please review the attached spec.", null, [fileId]);
    await h.runWake();
    expect(h.wakePrompts[0]).toContain(`Please review the attached spec. [attachments: spec.md (file_id=${fileId})]`);

    const deps = { db: h.connection.db, organization: new OrganizationService(h.connection.db), chat: new ChatService(h.connection.db) };
    const ctx: AgentToolContext = {
      orgId: h.orgId, agent: { id: h.ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    };
    expect(dispatchAgentTool(deps, ctx, { id: "c1", name: "read_messages", arguments: { with: "Yang" } })).toContain(`[attachments: spec.md (file_id=${fileId})]`);
    expect(dispatchAgentTool(deps, ctx, { id: "c2", name: "read_attachment", arguments: { file_id: fileId } })).toContain("Ship the booking API by Friday.");
    h.connection.close();
  });
});
