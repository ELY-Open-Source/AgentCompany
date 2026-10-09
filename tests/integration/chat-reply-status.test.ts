import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { ChatService } from "../../src/main/services/chat-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { expireStaleChatWakes } from "../../src/main/services/chat-agent-wake-service";
import { spaceHistory } from "../../src/main/services/chat-history";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("a message's reply status", () => {
  test("says whether the reply is queued, waiting and until when, expired, or failed and why", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-reply-status-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault);
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
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
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const dm = (connection.db.prepare("select id from chat_spaces where org_id = ? and space_type = 'direct'").get(orgId) as { id: string }).id;
    const messageId = connection.transaction(() => new ChatService(connection.db).sendMessage({
      orgId, spaceId: dm, threadId: null, senderType: "employee", senderId: employeeId, bodyMd: "Status?", attachmentFileIds: [],
    }));
    const status = () => new SnapshotService(connection.db).load().chatReplyStatuses.filter((item) => item.messageId === messageId);

    expect(status()).toEqual([{ messageId, agentId: ceoId, state: "queued", detail: null, resumesAt: null }]);
    // The CEO answers channel messages that name no one.
    const general = (connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'general'").get(orgId) as { id: string }).id;
    expect(new SnapshotService(connection.db).load().chatSpaceAnchors.find((item) => item.spaceId === general)).toEqual({ spaceId: general, agentId: ceoId });
    // A second message folded into the same queued reply gets the same status.
    const follow = connection.transaction(() => new ChatService(connection.db).sendMessage({
      orgId, spaceId: dm, threadId: (connection.db.prepare("select thread_id from chat_messages where id = ?").get(messageId) as { thread_id: string }).thread_id,
      senderType: "employee", senderId: employeeId, bodyMd: "Also, the budget?", attachmentFileIds: [],
    }));
    expect(new SnapshotService(connection.db).load().chatReplyStatuses.filter((item) => item.messageId === follow).map((item) => item.state)).toEqual(["queued"]);
    // A run that stopped at its step limit has not replied; the task continues.
    const wakeRun = connection.db.prepare("select id, task_id from task_runs where trigger = 'chat_mention'").get() as { id: string; task_id: string };
    connection.db.prepare("update task_runs set state = 'completed', completed_at = ? where id = ?").run(new Date().toISOString(), wakeRun.id);
    expect(status().map((item) => item.state)).toEqual(["queued"]);
    connection.db.prepare("insert into task_runs(id, org_id, task_id, agent_id, trigger, state, created_at) values ('run_continue', ?, ?, ?, 'heartbeat', 'running', ?)")
      .run(orgId, wakeRun.task_id, ceoId, new Date().toISOString());
    expect(status().map((item) => item.state)).toEqual(["running"]);
    connection.db.prepare("delete from task_runs where id = 'run_continue'").run();
    connection.db.prepare("update task_runs set state = 'queued', completed_at = null where id = ?").run(wakeRun.id);

    const providerId = (connection.db.prepare("select model_provider_id as id from agents where id = ?").get(ceoId) as { id: string }).id;
    const until = Date.now() + 120_000;
    connection.db.prepare("insert into provider_cooldowns(provider_id, label, until_ms, strikes) values (?, 'OpenAI', ?, 1)").run(providerId, until);
    expect(status()).toEqual([{
      messageId, agentId: ceoId, state: "waiting",
      detail: "OpenAI reported a passing failure; its work waits out a cooldown.", resumesAt: new Date(until).toISOString(),
    }]);
    // A message paged back from history carries its status too.
    expect(spaceHistory(connection.db, orgId, dm, null, { limit: 10 }).replyStatuses.filter((item) => item.messageId === messageId).map((item) => item.state)).toEqual(["waiting"]);

    connection.transaction(() => expireStaleChatWakes(connection.db, new Date(Date.now() + 2 * 60 * 60_000).toISOString()));
    expect(status()).toEqual([{
      messageId, agentId: ceoId, state: "expired",
      detail: "Expired: the conversation moved on before this reply could start. A newer message re-wakes the agent.", resumesAt: null,
    }]);

    connection.db.prepare("update task_runs set error_message = 'Provider refused the request' where trigger = 'chat_mention'").run();
    expect(status()).toEqual([{ messageId, agentId: ceoId, state: "failed", detail: "Provider refused the request", resumesAt: null }]);
    connection.close();
  });
});
