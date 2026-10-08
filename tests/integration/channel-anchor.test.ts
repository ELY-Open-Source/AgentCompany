import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ChatService } from "../../src/main/services/chat-service";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { canonicalMentionHandle } from "../../src/shared/mention-handles";
import type { AgentTurnResult, ProviderToolTurnInput, ToolCall } from "../../src/main/services/provider-tool-turn";
import { answeringModelCheck } from "../helpers/model-check";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

/** CEO answers in the thread the wake prompt names, then finishes. */
function scriptedCeoReply(): (input: ProviderToolTurnInput) => Promise<AgentTurnResult> {
  let turn = 0;
  return async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
    const firstUser = input.messages.find((message) => message.role === "user");
    const threadId = firstUser ? /thread_id="([^"]+)"/.exec(firstUser.text)?.[1] : undefined;
    const scripted = turn === 0
      ? { text: "Answering.", toolCalls: [call("send_message", { channel: "general", body: "Here is where we stand: kickoff is planned.", ...(threadId ? { thread_id: threadId } : {}) })] }
      : { text: "Done.", toolCalls: [] };
    turn += 1;
    return { text: scripted.text, toolCalls: scripted.toolCalls, rawResponseJson: "{}" };
  };
}

describe("channel anchor wake", () => {
  test("a plain user message in a channel wakes the most senior member, who replies", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-anchor-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault, answeringModelCheck(scriptedCeoReply()));
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const taskExecution = new TaskExecutionService(connection.db, providers);
    const chat = new ChatService(connection.db);

    let orgId = "";
    connection.transaction(() => {
      orgId = onboarding.bootstrap({
        companyName: "OrbitOps AI",
        companyDescription: "AI-run operations company.",
        employeeName: "Yang",
        workspacePath: "",
        executionMode: "ai_ceo",
        autoApproveHires: true,
        reviewDeliverables: false,
        goalTitle: "Stand up a service business.",
        goalDescription: "Win the first customers.",
        providerKey: "openai",
        providerSecret: "sk-test-key",
        providerModel: "gpt-5.4",
      }).orgId;
    });

    const employee = connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string };
    const general = connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'general'").get(orgId) as { id: string };
    const ceo = connection.db.prepare("select id from agents where org_id = ? and role_level = 'c_suite'").get(orgId) as { id: string };

    // A plain message: no @mention, no thread. Somebody must still answer.
    connection.transaction(() => {
      chat.sendMessage({
        orgId,
        spaceId: general.id,
        threadId: null,
        senderType: "employee",
        senderId: employee.id,
        bodyMd: "Where do we stand on the goal?",
        attachmentFileIds: [],
      });
    });

    const wake = connection.db.prepare(
      "select id, agent_id, state, trigger from task_runs where org_id = ? and trigger = 'chat_mention'",
    ).all(orgId) as Array<{ id: string; agent_id: string; state: string; trigger: string }>;
    expect(wake).toHaveLength(1);
    expect(wake[0]).toMatchObject({ agent_id: ceo.id, state: "queued" });

    // The woken CEO answers in #general.
    await taskExecution.executeRun(orgId, wake[0].id);
    const reply = connection.db.prepare(
      "select body_md from chat_messages where org_id = ? and space_id = ? and sender_type = 'agent' and sender_id = ?",
    ).get(orgId, general.id, ceo.id) as { body_md: string } | undefined;
    expect(reply?.body_md).toContain("Here is where we stand");

    // An explicit @mention wakes only the mentioned agent - no anchor duplicate.
    connection.transaction(() => {
      chat.sendMessage({
        orgId,
        spaceId: general.id,
        threadId: null,
        senderType: "employee",
        senderId: employee.id,
        bodyMd: `@${canonicalMentionHandle("CEO")} thanks, keep me posted.`,
        attachmentFileIds: [],
      });
    });
    const runsAfterMention = connection.db.prepare(
      "select count(*) as count from task_runs where org_id = ? and trigger = 'chat_mention'",
    ).get(orgId) as { count: number };
    expect(runsAfterMention.count).toBe(2);

    connection.close();
  });
});
