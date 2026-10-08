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
import type { AgentTurnResult } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("money budgets", () => {
  test("a run's model calls cost real money, and an agent past its monthly budget is refused and parked", async () => {
    let calls = 0;
    const turn = async (): Promise<AgentTurnResult> => {
      calls += 1;
      return { text: "Worked.", toolCalls: [], rawResponseJson: JSON.stringify({ usage: { input_tokens: 2_000_000, output_tokens: 1_000_000 } }) };
    };
    const connection = new DatabaseConnection(join(tmpdir(), `ac-spend-${randomUUID()}.db`));
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
    const providerId = (connection.db.prepare("select model_provider_id as id from agents where id = ?").get(ceoId) as { id: string }).id;
    providers.setPrices({ orgId, providerId, inputDollarsPerMtok: 2.5, cachedInputDollarsPerMtok: null, outputDollarsPerMtok: 10 });
    connection.db.prepare("update agents set budget_cents = 2000 where id = ?").run(ceoId);

    const first = claimNextQueuedRun(connection)!;
    await execution.executeRun(orgId, first.id);
    expect(connection.db.prepare("select agent_id, task_run_id, input_tokens, output_tokens, cost_cents from provider_requests where task_run_id = ?").get(first.id))
      .toEqual({ agent_id: ceoId, task_run_id: first.id, input_tokens: 2_000_000, output_tokens: 1_000_000, cost_cents: 500 + 1000 });

    const second = connection.transaction(() => execution.enqueueHeartbeatRuns());
    expect(second).toHaveLength(1);
    connection.db.prepare("update task_runs set state = 'running' where id = ?").run(second[0]);
    await execution.executeRun(orgId, second[0]);
    expect(calls).toBe(2);

    // $30 spent of a $20 budget: the next call is refused before it is made, and the heartbeat parks the agent.
    connection.db.prepare("update task_runs set created_at = '2000-01-01T00:00:00.000Z'").run();
    expect(connection.transaction(() => execution.enqueueHeartbeatRuns())).toEqual([]);
    const third = execution.runTask({ orgId, taskId: (connection.db.prepare("select task_id from task_runs where id = ?").get(first.id) as { task_id: string }).task_id });
    await expect(third).rejects.toThrow("CEO has spent its monthly budget ($30.00 of $20.00). Raise the budget or wait for next month.");
    expect(calls).toBe(2);

    // A $0 budget allows no paid call, and unpriced calls are never blocked by money.
    connection.db.prepare("update agents set budget_cents = 0 where id = ?").run(ceoId);
    connection.db.prepare("delete from provider_requests").run();
    const kickoffTask = (connection.db.prepare("select task_id from task_runs where id = ?").get(first.id) as { task_id: string }).task_id;
    connection.db.prepare("update task_runs set state = 'failed' where state in ('queued', 'running')").run();
    await expect(execution.runTask({ orgId, taskId: kickoffTask })).rejects.toThrow("CEO has spent its monthly budget ($0.00 of $0.00).");
    providers.setPrices({ orgId, providerId, inputDollarsPerMtok: null, cachedInputDollarsPerMtok: null, outputDollarsPerMtok: null });
    await execution.runTask({ orgId, taskId: kickoffTask });
    expect(calls).toBe(3);

    // Department spend stays with the department that made it, even after the agent moves.
    providers.setPrices({ orgId, providerId, inputDollarsPerMtok: 2.5, cachedInputDollarsPerMtok: null, outputDollarsPerMtok: 10 });
    connection.db.prepare("update agents set budget_cents = 1000000 where id = ?").run(ceoId);
    connection.db.prepare("update org_departments set monthly_budget_limit_cents = 1000 where org_id = ? and name = 'Executive'").run(orgId);
    connection.db.prepare("update provider_requests set cost_cents = 1500").run();
    connection.db.prepare("update agents set department = 'Design' where id = ?").run(ceoId);
    expect(connection.db.prepare("select department from provider_requests").get()).toEqual({ department: "Executive" });
    connection.db.prepare("update agents set department = 'Executive' where id = ?").run(ceoId);
    await expect(execution.runTask({ orgId, taskId: kickoffTask })).rejects.toThrow("The Executive department has spent its monthly budget ($15.00 of $10.00).");
    connection.close();
  });
});
