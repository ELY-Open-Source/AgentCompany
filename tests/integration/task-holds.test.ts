import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { currentProviderUsageWindow } from "../../src/shared/provider-runtime-domain";
import type { AgentTurnResult } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

/** A company whose kickoff task is open with no run in flight. */
function company() {
  const turn = async (): Promise<AgentTurnResult> => ({ text: "Done.", toolCalls: [], rawResponseJson: "{}" });
  const connection = new DatabaseConnection(join(tmpdir(), `ac-task-holds-${randomUUID()}.db`));
  const providers = new ProviderService(connection.db, providerAdapters, testVault, turn);
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
  const run = connection.db.prepare("select id, task_id, provider_id from task_runs").get() as { id: string; task_id: string; provider_id: string };
  connection.db.prepare("update task_runs set state = 'failed' where id = ?").run(run.id);
  const hold = () => new SnapshotService(connection.db).load().tasks.find((task) => task.id === run.task_id)!.hold;
  return { connection, providers, execution, orgId, ceoId, taskId: run.task_id, providerId: run.provider_id, hold };
}

describe("why an open task is not moving", () => {
  test("an open task with nothing in its way has no hold", () => {
    const h = company();
    expect(h.hold()).toBeNull();
    h.connection.close();
  });

  test("a provider cooldown says when the task resumes on its own", () => {
    const h = company();
    const until = Date.now() + 90_000;
    h.connection.db.prepare("insert into provider_cooldowns(provider_id, label, until_ms, strikes) values (?, 'OpenAI', ?, 2)").run(h.providerId, until);
    expect(h.hold()).toEqual({ reason: "OpenAI reported a passing failure; its work waits out a cooldown.", resumesAt: new Date(until).toISOString(), waitingOn: "provider" });
    h.connection.close();
  });

  test("a spent monthly request limit waits on the operator or the next window, and a zero limit only on the operator", () => {
    const h = company();
    const window = currentProviderUsageWindow();
    h.connection.db.prepare("update providers set monthly_request_limit = 2 where id = ?").run(h.providerId);
    h.connection.db.prepare(`
      insert into provider_usage_windows(id, org_id, provider_id, window_start, window_end, request_count, input_char_count, output_char_count, created_at, updated_at)
      values ('puw_t', ?, ?, ?, ?, 2, 0, 0, ?, ?)
    `).run(h.orgId, h.providerId, window.start, window.end, new Date().toISOString(), new Date().toISOString());
    expect(h.hold()).toEqual({ reason: "OpenAI used its monthly request limit (2). Raise the limit or wait for the next window.", resumesAt: window.end, waitingOn: "operator" });
    h.connection.db.prepare("update providers set monthly_request_limit = 0 where id = ?").run(h.providerId);
    expect(h.hold()).toEqual({ reason: "OpenAI has a monthly request limit of 0. Raise the limit to let its work run.", resumesAt: null, waitingOn: "operator" });
    h.connection.close();
  });

  test("a spent money budget waits on the operator or next month, and a zero budget only on the operator", () => {
    const h = company();
    h.providers.setPrices({ orgId: h.orgId, providerId: h.providerId, inputDollarsPerMtok: 2.5, cachedInputDollarsPerMtok: null, outputDollarsPerMtok: 10 });
    h.connection.db.prepare("update agents set budget_cents = 100 where id = ?").run(h.ceoId);
    h.connection.db.prepare(`
      insert into provider_requests(id, org_id, provider_id, provider_key, agent_id, model, prompt_sha256, state, created_at, cost_cents)
      values ('preq_t', ?, ?, 'openai', ?, 'gpt-5.4', 'x', 'succeeded', ?, 150)
    `).run(h.orgId, h.providerId, h.ceoId, new Date().toISOString());
    expect(h.hold()).toEqual({
      reason: "CEO has spent its monthly budget ($1.50 of $1.00). Raise the budget or wait for next month.",
      resumesAt: currentProviderUsageWindow().end,
      waitingOn: "operator",
    });
    h.connection.db.prepare("update agents set budget_cents = 0 where id = ?").run(h.ceoId);
    expect(h.hold()).toEqual({ reason: "CEO has spent its monthly budget ($1.50 of $0.00). Raise the budget to let it run.", resumesAt: null, waitingOn: "operator" });
    h.connection.close();
  });

  test("a heartbeat that could not queue the task records why, until it can", () => {
    const h = company();
    h.connection.db.prepare("update tasks set risk = 'high' where id = ?").run(h.taskId);
    expect(h.connection.transaction(() => h.execution.enqueueHeartbeatRuns())).toEqual([]);
    expect(h.hold()).toEqual({ reason: "Could not start: Approved task execution approval is required.", resumesAt: null, waitingOn: "operator" });
    h.connection.db.prepare("update tasks set risk = 'low' where id = ?").run(h.taskId);
    expect(h.connection.transaction(() => h.execution.enqueueHeartbeatRuns())).toHaveLength(1);
    expect(h.hold()).toBeNull();
    h.connection.close();
  });

  test("a stalled task waits on the operator with no resume time", () => {
    const h = company();
    h.connection.db.prepare("update tasks set stalled_reason = 'Stalled: 3 sessions made no progress.' where id = ?").run(h.taskId);
    expect(h.hold()).toEqual({ reason: "Stalled: 3 sessions made no progress.", resumesAt: null, waitingOn: "operator" });
    h.connection.close();
  });
});
