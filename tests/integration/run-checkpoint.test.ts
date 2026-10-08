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
import type { AgentTurnResult } from "../../src/main/services/provider-tool-turn";
import { answeringModelCheck } from "../helpers/model-check";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("session checkpoints", () => {
  test("a chat reply still working at the step limit stays open and posts no stand-in reply", async () => {
    let finishing = false;
    const turn = async (): Promise<AgentTurnResult> => finishing
      ? { text: "Audit done: all clean.", toolCalls: [], rawResponseJson: "{}" }
      : { text: "Looking into it.", toolCalls: [{ id: `c_${randomUUID()}`, name: "read_messages", arguments: {} }], rawResponseJson: "{}" };
    const connection = new DatabaseConnection(join(tmpdir(), `ac-checkpoint-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, answeringModelCheck(turn));
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const execution = new TaskExecutionService(connection.db, providers);
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
    connection.db.prepare("update task_runs set state = 'completed' where state = 'queued'").run();
    const founder = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    new ChatService(connection.db).sendMessage({
      orgId, spaceId: ensureCeoDirectSpace(connection.db, orgId)!, threadId: null,
      senderType: "employee", senderId: founder, bodyMd: "Audit every repo, please.", attachmentFileIds: [],
    });
    const wake = claimNextQueuedRun(connection)!;
    await execution.executeRun(orgId, wake.id);
    const run = connection.db.prepare("select r.state, t.status from task_runs r join tasks t on t.id = r.task_id where r.id = ?").get(wake.id);
    expect(run).toEqual({ state: "completed", status: "backlog" });
    expect(connection.db.prepare("select count(*) as n from chat_messages where sender_type = 'agent' and sender_id = ?").get(ceoId)).toEqual({ n: 0 });

    // The heartbeat continuation answers and closes the conversation's task.
    finishing = true;
    const wakeTask = (connection.db.prepare("select task_id from task_runs where id = ?").get(wake.id) as { task_id: string }).task_id;
    connection.db.prepare("update task_runs set created_at = '2000-01-01T00:00:00.000Z' where agent_id = ?").run(ceoId);
    connection.db.prepare("update tasks set status = 'done' where origin is null").run();
    const queued = connection.transaction(() => execution.enqueueHeartbeatRuns());
    const continuation = queued.find((id) => (connection.db.prepare("select task_id from task_runs where id = ?").get(id) as { task_id: string }).task_id === wakeTask)!;
    connection.db.prepare("update task_runs set state = 'running' where id = ?").run(continuation);
    await execution.executeRun(orgId, continuation);
    expect(connection.db.prepare("select status from tasks where id = ?").get(wakeTask)).toEqual({ status: "done" });
    expect(connection.db.prepare("select count(*) as n from chat_messages where sender_type = 'agent' and sender_id = ? and body_md = 'Audit done: all clean.'").get(ceoId)).toEqual({ n: 1 });
    connection.close();
  });
});
