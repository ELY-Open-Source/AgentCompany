import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";
import { ChatService } from "../../src/main/services/chat-service";
import { ensureCeoDirectSpace } from "../../src/main/services/ceo-direct-space";
import type { AgentTurnResult } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function company() {
  let calls = 0;
  const turn = async (): Promise<AgentTurnResult> => {
    calls += 1;
    return { text: "done", toolCalls: [], rawResponseJson: "{}" };
  };
  const connection = new DatabaseConnection(join(tmpdir(), `ac-stale-${randomUUID()}.db`));
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
  const claim = () => {
    const run = claimNextQueuedRun(connection)!;
    const taskId = (connection.db.prepare("select task_id from task_runs where id = ?").get(run.id) as { task_id: string }).task_id;
    return { runId: run.id, taskId };
  };
  const runRow = (runId: string) => connection.db.prepare("select state, error_message from task_runs where id = ?").get(runId) as { state: string; error_message: string };
  const memories = () => (connection.db.prepare("select count(*) as n from knowledge_entries where org_id = ?").get(orgId) as { n: number }).n;
  return { connection, execution, providers, orgId, ceoId, claim, runRow, memories, calls: () => calls };
}

describe("stale queued runs", () => {
  test("a run whose task closed after it was queued is superseded, not failed or remembered", async () => {
    const h = company();
    const { runId, taskId } = h.claim();
    h.connection.db.prepare("update tasks set status = 'done' where id = ?").run(taskId);
    await expect(h.execution.executeRun(h.orgId, runId)).resolves.toBe(runId);
    expect(h.runRow(runId)).toEqual({ state: "superseded", error_message: "Superseded: the task was closed after this run was queued." });
    expect(h.memories()).toBe(0);
    expect(h.calls()).toBe(0);
    h.connection.close();
  });

  test("a provider switch after queueing supersedes the run and the next heartbeat queues a fresh one", async () => {
    const h = company();
    const { runId, taskId } = h.claim();
    const newProvider = (h.connection.db.prepare("select id from providers where org_id = ? and provider_key = 'anthropic'").get(h.orgId) as { id: string }).id;
    h.providers.saveCredential({ orgId: h.orgId, providerId: newProvider, secret: "sk-ant", model: "claude-sonnet-5-5" });
    h.connection.db.prepare("update agents set model_provider_id = ? where id = ?").run(newProvider, h.ceoId);
    await h.execution.executeRun(h.orgId, runId);
    expect(h.runRow(runId).state).toBe("superseded");
    expect(h.runRow(runId).error_message).toContain("the assignee's provider changed");

    const requeued = h.connection.transaction(() => h.execution.enqueueHeartbeatRuns());
    expect(requeued).toHaveLength(1);
    expect(h.connection.db.prepare("select task_id, provider_id from task_runs where id = ?").get(requeued[0])).toEqual({ task_id: taskId, provider_id: newProvider });
    h.connection.close();
  });

  test("workspace scope and approval changes after queueing supersede the run", async () => {
    const h = company();
    const first = h.claim();
    h.connection.db.prepare("update tasks set risk = 'high' where id = ?").run(first.taskId);
    await h.execution.executeRun(h.orgId, first.runId);
    expect(h.runRow(first.runId)).toEqual({ state: "superseded", error_message: "Superseded: Approved task execution approval is required." });

    h.connection.db.prepare("update tasks set risk = 'low', requires_filesystem = 0 where id = ?").run(first.taskId);
    h.connection.db.prepare("update task_runs set state = 'queued', error_message = null, completed_at = null where id = ?").run(first.runId);
    h.connection.db.prepare("update task_runs set workspace_mount_json = ? where id = ?")
      .run(JSON.stringify([{ workspaceId: "wsp_elsewhere", mode: "read_only" }]), first.runId);
    const second = h.claim();
    await h.execution.executeRun(h.orgId, second.runId);
    expect(h.runRow(second.runId).error_message).toBe("Superseded: the task's workspace access changed after this run was queued.");
    expect(h.calls()).toBe(0);
    h.connection.close();
  });

  test("a superseded chat wake closes its reply task instead of being re-queued as background work", async () => {
    const h = company();
    const kickoff = h.claim();
    await h.execution.executeRun(h.orgId, kickoff.runId);
    const founder = (h.connection.db.prepare("select id from employees where org_id = ?").get(h.orgId) as { id: string }).id;
    new ChatService(h.connection.db).sendMessage({
      orgId: h.orgId, spaceId: ensureCeoDirectSpace(h.connection.db, h.orgId)!, threadId: null,
      senderType: "employee", senderId: founder, bodyMd: "Status?", attachmentFileIds: [],
    });
    const wake = h.connection.db.prepare("select id, task_id from task_runs where agent_id = ? and trigger = 'chat_mention' and state = 'queued'").get(h.ceoId) as { id: string; task_id: string };
    h.connection.db.prepare("update task_runs set state = 'running' where id = ?").run(wake.id);
    h.connection.db.prepare("update tasks set assignee_agent_id = null where id = ?").run(wake.task_id);
    await h.execution.executeRun(h.orgId, wake.id);
    expect(h.runRow(wake.id).state).toBe("superseded");
    expect(h.connection.db.prepare("select status from tasks where id = ?").get(wake.task_id)).toEqual({ status: "done" });
    h.connection.close();
  });

  test("a reassigned task supersedes its queued run; superseded runs never spend the retry budget", async () => {
    const h = company();
    const { runId, taskId } = h.claim();
    h.connection.db.prepare("update tasks set assignee_agent_id = null where id = ?").run(taskId);
    await h.execution.executeRun(h.orgId, runId);
    expect(h.runRow(runId).state).toBe("superseded");
    expect(h.runRow(runId).error_message).toContain("reassigned");
    h.connection.db.prepare("update tasks set assignee_agent_id = ? where id = ?").run(h.ceoId, taskId);
    for (let index = 0; index < 4; index += 1) {
      h.connection.db.prepare("insert into task_runs(id, org_id, task_id, agent_id, provider_id, trigger, state, created_at, error_message) values (?, ?, ?, ?, null, 'heartbeat', 'superseded', ?, 'Superseded: x')")
        .run(`run_s${index}`, h.orgId, taskId, h.ceoId, new Date().toISOString());
    }
    expect(h.connection.transaction(() => h.execution.enqueueHeartbeatRuns())).toHaveLength(1);
    h.connection.close();
  });
});
