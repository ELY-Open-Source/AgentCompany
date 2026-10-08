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
import type { AgentTurnResult, ProviderToolTurnInput, ToolCall } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

/**
 * Scripts a CEO who never calls send_message: the chat-wake run is answered
 * with plain final text only — the way a direct-answering model (e.g. a
 * coding-tuned one) responds when it treats the wake as a question, not a
 * conversation to post into.
 */
function plainTextCeo(): (input: ProviderToolTurnInput) => Promise<AgentTurnResult> {
  return async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
    const firstUser = input.messages.find((message) => message.role === "user");
    const prompt = firstUser?.text ?? "";
    if (!/thread_id="/.test(prompt)) {
      return { text: "Kickoff noted.", toolCalls: [], rawResponseJson: "{}" };
    }
    return { text: "We are on track — the kickoff wave is planned.", toolCalls: [], rawResponseJson: "{}" };
  };
}

/**
 * Scripts the CEO: the kickoff run ends quietly; the chat-wake run (its
 * prompt carries the thread transcript) is captured and answered with a
 * direct reply to the founder in the same thread.
 */
function scriptedCeo(capturedWakePrompts: string[]): (input: ProviderToolTurnInput) => Promise<AgentTurnResult> {
  let replied = false;
  return async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
    const firstUser = input.messages.find((message) => message.role === "user");
    const prompt = firstUser?.text ?? "";
    if (!/thread_id="/.test(prompt)) {
      return { text: "Kickoff noted.", toolCalls: [], rawResponseJson: "{}" };
    }
    if (replied) return { text: "Replied.", toolCalls: [], rawResponseJson: "{}" };
    replied = true;
    capturedWakePrompts.push(prompt);
    const threadId = /thread_id="([^"]+)"/.exec(prompt)![1];
    return {
      text: "Answering the founder.",
      toolCalls: [call("send_message", { to: "Yang", body: "We are on track — the kickoff wave is planned.", thread_id: threadId })],
      rawResponseJson: "{}",
    };
  };
}

describe("founder⇄CEO chat", () => {
  test("a founder DM wakes the CEO, who sees who is asking and replies in the pinned conversation", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-ceo-chat-${randomUUID()}.db`));
    const capturedWakePrompts: string[] = [];
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, scriptedCeo(capturedWakePrompts));
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const taskExecution = new TaskExecutionService(connection.db, providers);
    const chat = new ChatService(connection.db);

    let orgId = "";
    let ceoId = "";
    connection.transaction(() => {
      const summary = onboarding.bootstrap({
        companyName: "FlowPilot",
        companyDescription: "CSM analytics for SMBs.",
        employeeName: "Yang",
        workspacePath: "",
        executionMode: "ai_ceo",
        autoApproveHires: true,
        reviewDeliverables: false,
        goalTitle: "Ship the MVP.",
        goalDescription: "A working product.",
        providerKey: "openai",
        providerSecret: "sk-test-key",
        providerModel: "gpt-5.4",
      });
      orgId = summary.orgId;
      ceoId = summary.ceoAgentId;
    });
    const founder = connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string };

    // Onboarding already created the pinned conversation; ensure only finds it.
    const pinnedSpaceId = ensureCeoDirectSpace(connection.db, orgId);
    expect(pinnedSpaceId).toBeTruthy();

    // Drain the kickoff run so the next queued run is the chat wake.
    const kickoff = claimNextQueuedRun(connection);
    await taskExecution.executeRun(kickoff!.org_id, kickoff!.id);

    const founderMessageId = chat.sendMessage({
      orgId,
      spaceId: pinnedSpaceId!,
      threadId: null,
      senderType: "employee",
      senderId: founder.id,
      bodyMd: "How are we tracking against the MVP?",
      attachmentFileIds: [],
    });
    const founderThreadId = (connection.db.prepare("select thread_id from chat_messages where id = ?")
      .get(founderMessageId) as { thread_id: string }).thread_id;

    const wake = connection.db.prepare(
      "select id from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention' and state = 'queued'",
    ).get(orgId, ceoId) as { id: string };
    await taskExecution.executeRun(orgId, wake.id);

    // The CEO's prompt names the human principal, not just another teammate.
    expect(capturedWakePrompts).toHaveLength(1);
    expect(capturedWakePrompts[0]).toMatch(/\] Yang \(employee, Board Chair\): How are we tracking against the MVP\?/);

    // The reply landed in the SAME pinned conversation and thread — to="Yang"
    // resolves the employee and ensureDirectSpace reuses the founder's line.
    const reply = connection.db.prepare(
      "select space_id, thread_id, body_md from chat_messages where org_id = ? and sender_type = 'agent' and sender_id = ?",
    ).get(orgId, ceoId) as { space_id: string; thread_id: string; body_md: string };
    expect(reply.space_id).toBe(pinnedSpaceId);
    expect(reply.thread_id).toBe(founderThreadId);
    expect(reply.body_md).toContain("on track");

    // The reply was the wake task's deliverable; completing the run closed it.
    const wakeTask = connection.db.prepare(
      "select t.status from tasks t join task_runs r on r.task_id = t.id where r.id = ?",
    ).get(wake.id) as { status: string };
    expect(wakeTask).toEqual({ status: "done" });

    connection.close();
  });

  test("a CEO who answers in plain text still has the reply delivered into the founder's thread", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-ceo-plain-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, plainTextCeo());
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const taskExecution = new TaskExecutionService(connection.db, providers);
    const chat = new ChatService(connection.db);

    let orgId = "";
    let ceoId = "";
    connection.transaction(() => {
      const summary = onboarding.bootstrap({
        companyName: "FlowPilot",
        companyDescription: "CSM analytics for SMBs.",
        employeeName: "Yang",
        workspacePath: "",
        executionMode: "ai_ceo",
        autoApproveHires: true,
        reviewDeliverables: false,
        goalTitle: "Ship the MVP.",
        goalDescription: "A working product.",
        providerKey: "openai",
        providerSecret: "sk-test-key",
        providerModel: "gpt-5.4",
      });
      orgId = summary.orgId;
      ceoId = summary.ceoAgentId;
    });
    const founder = connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string };
    const pinnedSpaceId = ensureCeoDirectSpace(connection.db, orgId);

    // Drain the kickoff run so the next queued run is the chat wake.
    const kickoff = claimNextQueuedRun(connection);
    await taskExecution.executeRun(kickoff!.org_id, kickoff!.id);

    const founderMessageId = chat.sendMessage({
      orgId,
      spaceId: pinnedSpaceId!,
      threadId: null,
      senderType: "employee",
      senderId: founder.id,
      bodyMd: "How are we tracking against the MVP?",
      attachmentFileIds: [],
    });
    const founderThreadId = (connection.db.prepare("select thread_id from chat_messages where id = ?")
      .get(founderMessageId) as { thread_id: string }).thread_id;

    const wake = connection.db.prepare(
      "select id from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention' and state = 'queued'",
    ).get(orgId, ceoId) as { id: string };
    await taskExecution.executeRun(orgId, wake.id);

    // The model answered in its final text and never called send_message; the
    // reply must still land in the founder's thread — exactly once.
    const replies = connection.db.prepare(
      "select space_id, thread_id, body_md from chat_messages where org_id = ? and sender_type = 'agent' and sender_id = ?",
    ).all(orgId, ceoId) as Array<{ space_id: string; thread_id: string; body_md: string }>;
    expect(replies).toHaveLength(1);
    expect(replies[0].space_id).toBe(pinnedSpaceId);
    expect(replies[0].thread_id).toBe(founderThreadId);
    expect(replies[0].body_md).toContain("on track");

    // The run completed and closed its wake task, not failed on a delivery it made.
    const wakeRun = connection.db.prepare("select state, error_message from task_runs where id = ?")
      .get(wake.id) as { state: string; error_message: string | null };
    expect(wakeRun).toMatchObject({ state: "completed", error_message: null });
    const wakeTask = connection.db.prepare(
      "select t.status from tasks t join task_runs r on r.task_id = t.id where r.id = ?",
    ).get(wake.id) as { status: string };
    expect(wakeTask).toEqual({ status: "done" });

    connection.close();
  });
});
