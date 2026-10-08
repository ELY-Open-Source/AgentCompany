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

async function company(reply: (prompt: string) => AgentTurnResult) {
  const prompts: string[] = [];
  const turn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
    const first = input.messages.find((message) => message.role === "user");
    const prompt = first && first.role === "user" ? first.text : "";
    prompts.push(prompt);
    return reply(prompt);
  };
  const connection = new DatabaseConnection(join(tmpdir(), `ac-memory-${randomUUID()}.db`));
  const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, turn);
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
  const memories = () => connection.db.prepare("select topic, category, content, source_type from knowledge_entries where org_id = ? order by created_at")
    .all(orgId) as Array<{ topic: string; category: string; content: string; source_type: string }>;
  return { connection, execution, orgId, ceoId, prompts, memories };
}

describe("run memory", () => {
  test("a finished run of real work leaves its conclusion; prompts ask agents to record learnings", async () => {
    const h = await company(() => ({ text: "Chose Postgres for bookings; MySQL lacked the JSON features we need.", toolCalls: [], rawResponseJson: "{}" }));
    const kickoff = claimNextQueuedRun(h.connection)!;
    await h.execution.executeRun(h.orgId, kickoff.id);
    expect(h.prompts[0]).toContain("record anything the company should remember");
    expect(h.memories()).toEqual([{
      topic: expect.stringMatching(/^Outcome: /), category: "run_outcome",
      content: "Chose Postgres for bookings; MySQL lacked the JSON features we need.", source_type: "task_run",
    }]);
    const project = (h.connection.db.prepare("select t.project_id from tasks t join task_runs r on r.task_id = t.id where r.id = ?").get(kickoff.id) as { project_id: string | null }).project_id;
    expect(project).not.toBeNull();
    expect(h.connection.db.prepare("select scope_type, scope_id from knowledge_entries").get()).toEqual({ scope_type: "project", scope_id: project });
    h.connection.close();
  });

  test("a real failure is remembered; a transient provider failure is not", async () => {
    let failure = "Workspace build failed: missing package.json";
    const h = await company(() => { throw new Error(failure); });
    const first = claimNextQueuedRun(h.connection)!;
    await expect(h.execution.executeRun(h.orgId, first.id)).rejects.toThrow(failure);
    expect(h.memories().map((entry) => [entry.category, entry.content])).toEqual([["failure_cause", failure]]);

    failure = "429 rate limit exceeded";
    h.connection.db.prepare("update task_runs set state = 'queued' where id = ?").run(first.id);
    const second = claimNextQueuedRun(h.connection)!;
    await expect(h.execution.executeRun(h.orgId, second.id)).rejects.toThrow(failure);
    expect(h.memories()).toHaveLength(1);
    h.connection.close();
  });

  test("a run that fails before it starts is remembered too", async () => {
    const h = await company(() => ({ text: "unused", toolCalls: [], rawResponseJson: "{}" }));
    const kickoff = claimNextQueuedRun(h.connection)!;
    h.connection.db.prepare("delete from providers where id = (select provider_id from task_runs where id = ?)").run(kickoff.id);
    await expect(h.execution.executeRun(h.orgId, kickoff.id)).rejects.toThrow("Task assignee provider was not found.");
    expect(h.memories().map((entry) => entry.category)).toEqual(["failure_cause"]);
    expect(h.memories()[0].content).toContain("Task assignee provider was not found.");
    h.connection.close();
  });

  test("a claimed run whose agent lost its provider fails cleanly and frees the task", async () => {
    const h = await company(() => ({ text: "unused", toolCalls: [], rawResponseJson: "{}" }));
    const kickoff = claimNextQueuedRun(h.connection)!;
    h.connection.db.prepare("update agents set model_provider_id = null where id = ?").run(h.ceoId);
    await expect(h.execution.executeRun(h.orgId, kickoff.id)).rejects.toThrow("Task assignee requires a model provider.");
    expect(h.connection.db.prepare("select state, error_message, completed_at is not null as closed from task_runs where id = ?").get(kickoff.id))
      .toEqual({ state: "failed", error_message: "Task assignee requires a model provider.", closed: 1 });
    expect(h.connection.db.prepare("select count(*) as n from task_runs where state in ('queued', 'running')").get()).toEqual({ n: 0 });
    expect(h.connection.db.prepare("select action, json_extract(payload_json, '$.stage') as stage from audit_events where entity_id = ? and action = 'failed'").get(kickoff.id))
      .toEqual({ action: "failed", stage: "preparation" });
    h.connection.close();
  });

  test("chat replies are not auto-recorded", async () => {
    const h = await company((prompt) => ({ text: /thread_id="/.test(prompt) ? "Hiring two engineers this week." : "Kickoff noted.", toolCalls: [], rawResponseJson: "{}" }));
    const kickoff = claimNextQueuedRun(h.connection)!;
    await h.execution.executeRun(h.orgId, kickoff.id);
    const before = h.memories().length;
    const founder = (h.connection.db.prepare("select id from employees where org_id = ?").get(h.orgId) as { id: string }).id;
    new ChatService(h.connection.db).sendMessage({
      orgId: h.orgId, spaceId: ensureCeoDirectSpace(h.connection.db, h.orgId)!, threadId: null,
      senderType: "employee", senderId: founder, bodyMd: "Hiring plan?", attachmentFileIds: [],
    });
    const wake = h.connection.db.prepare("select id from task_runs where agent_id = ? and trigger = 'chat_mention' and state = 'queued'").get(h.ceoId) as { id: string };
    await h.execution.executeRun(h.orgId, wake.id);
    expect(h.prompts.at(-1)).toContain("record anything the company should remember");
    expect(h.memories()).toHaveLength(before);
    h.connection.close();
  });
});
