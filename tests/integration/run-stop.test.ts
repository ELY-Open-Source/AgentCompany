import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";
import { postJson } from "../../src/main/services/provider-http";
import { RUN_STOPPED_MESSAGE, stopRun, withRunControl } from "../../src/main/services/run-control";
import type { AgentTurnResult, ProviderToolTurnInput } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function company(turn: (input: ProviderToolTurnInput) => Promise<AgentTurnResult>) {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-stop-${randomUUID()}.db`));
  const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, turn);
  const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
  const execution = new TaskExecutionService(connection.db, providers);
  let orgId = "";
  connection.transaction(() => {
    orgId = onboarding.bootstrap({
      companyName: "FlowPilot", companyDescription: "CSM analytics.", employeeName: "Yang", workspacePath: "",
      executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false,
      goalTitle: "Ship the MVP.", goalDescription: "A working product.",
      providerKey: "openai", providerSecret: "sk-test-key", providerModel: "gpt-5.4",
    }).orgId;
  });
  return { connection, execution, orgId, claim: () => claimNextQueuedRun(connection)!.id };
}

describe("stopping runs", () => {
  test("a stopped run executes none of the tools its last turn asked for and spends no retry budget", async () => {
    let runId = "";
    const turn = async (): Promise<AgentTurnResult> => {
      stopRun(runId);
      return { text: "Announcing.", toolCalls: [{ id: "c1", name: "send_message", arguments: { channel: "general", body: "Should never be posted." } }], rawResponseJson: "{}" };
    };
    const connection = new DatabaseConnection(join(tmpdir(), `ac-stop-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, turn);
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    connection.transaction(() => {
      orgId = onboarding.bootstrap({
        companyName: "FlowPilot", companyDescription: "CSM analytics.", employeeName: "Yang", workspacePath: "",
        executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false,
        goalTitle: "Ship the MVP.", goalDescription: "A working product.",
        providerKey: "openai", providerSecret: "sk-test-key", providerModel: "gpt-5.4",
      }).orgId;
    });
    runId = claimNextQueuedRun(connection)!.id;
    await expect(execution.executeRun(orgId, runId)).rejects.toThrow(RUN_STOPPED_MESSAGE);
    expect(connection.db.prepare("select state, error_message from task_runs where id = ?").get(runId)).toEqual({ state: "stopped", error_message: RUN_STOPPED_MESSAGE });
    expect(connection.db.prepare("select count(*) as n from chat_messages where body_md = 'Should never be posted.'").get()).toEqual({ n: 0 });
    expect(connection.db.prepare("select count(*) as n from audit_events where entity_id = ? and action = 'stopped'").get(runId)).toEqual({ n: 1 });
    expect(stopRun(runId)).toBe(false);
    connection.close();
  });

  test("a stop during the goal audit keeps the goal open, and any error after a stop still counts as a stop", async () => {
    let runId = "";
    const turn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
      if (input.instructions?.startsWith("You are the independent completion auditor")) {
        stopRun(runId);
        return { text: "Verified. <approved/>", toolCalls: [], rawResponseJson: "{}" };
      }
      return { text: "Closing.", toolCalls: [{ id: "c1", name: "complete_goal", arguments: { goal_id: goalId, evidence: "Shipped." } }], rawResponseJson: "{}" };
    };
    const { connection, execution, orgId, claim } = company(turn);
    const goalId = (connection.db.prepare("select id from goals where org_id = ?").get(orgId) as { id: string }).id;
    runId = claim();
    await expect(execution.executeRun(orgId, runId)).rejects.toThrow(RUN_STOPPED_MESSAGE);
    expect(connection.db.prepare("select status from goals where id = ?").get(goalId)).toEqual({ status: "active" });
    expect(connection.db.prepare("select state from task_runs where id = ?").get(runId)).toEqual({ state: "stopped" });

    // The interrupted step may raise its own error; the run is still recorded as stopped, not failed.
    const failing = company(async () => {
      stopRun(failingRun);
      throw new Error("Provider overloaded");
    });
    const failingRun = failing.claim();
    await expect(failing.execution.executeRun(failing.orgId, failingRun)).rejects.toThrow();
    expect(failing.connection.db.prepare("select state from task_runs where id = ?").get(failingRun)).toEqual({ state: "stopped" });
    connection.close();
    failing.connection.close();
  });

  test("disconnecting a provider stops its running sessions, even when the turn ends with a final answer", async () => {
    let revoke = () => {};
    const { connection, execution, orgId, claim } = company(async () => {
      revoke();
      return { text: "All done.", toolCalls: [], rawResponseJson: "{}" };
    });
    const runId = claim();
    const providerId = (connection.db.prepare("select provider_id from task_runs where id = ?").get(runId) as { provider_id: string }).provider_id;
    const providers = new ProviderService(connection.db, providerAdapters, testVault);
    revoke = () => providers.revokeCredential({ orgId, providerId });
    await expect(execution.executeRun(orgId, runId)).rejects.toThrow("OpenAI was disconnected.");
    expect(connection.db.prepare("select state, error_message from task_runs where id = ?").get(runId)).toEqual({ state: "stopped", error_message: "OpenAI was disconnected." });
    connection.close();
  });

  test("stopping a run aborts its provider request in flight", async () => {
    const server = createServer(() => { /* never answers */ });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const started = Date.now();
    const request = withRunControl("run_http", () => postJson(`http://127.0.0.1:${port}/v1`, {}, { hello: "world" }));
    setTimeout(() => stopRun("run_http"), 50);
    await expect(request).rejects.toThrow(RUN_STOPPED_MESSAGE);
    expect(Date.now() - started).toBeLessThan(5_000);
    server.closeAllConnections();
    server.close();
  });
});
