import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { ChatService } from "../../src/main/services/chat-service";
import { ensureCeoDirectSpace } from "../../src/main/services/ceo-direct-space";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";
import type { AgentTurnResult, ProviderToolTurnInput } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

async function founderLine() {
  const wakePrompts: string[] = [];
  const turn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
    const first = input.messages.find((message) => message.role === "user");
    const prompt = first && first.role === "user" ? first.text : "";
    if (/thread_id="/.test(prompt) && input.messages.length === 1) wakePrompts.push(prompt);
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
  const say = (bodyMd: string, threadId: string | null) => {
    const id = chat.sendMessage({ orgId, spaceId, threadId, senderType: "employee", senderId: founderId, bodyMd, attachmentFileIds: [] });
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
  return { connection, wakePrompts, say, runWake, edit };
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
});
