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
import type { AgentTurnResult, ProviderToolTurnInput } from "../../src/main/services/provider-tool-turn";
import { answeringModelCheck } from "../helpers/model-check";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function company(turn: (input: ProviderToolTurnInput, db: DatabaseConnection["db"]) => AgentTurnResult) {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-goalchg-${randomUUID()}.db`));
  const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, answeringModelCheck(async (input) => turn(input, connection.db)));
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
  const goalId = (connection.db.prepare("select id from goals where org_id = ?").get(orgId) as { id: string }).id;
  return { connection, execution, orgId, goalId };
}

describe("goal changes", () => {
  test("work under an achieved goal stops: its queued run is superseded and the heartbeat leaves it alone", async () => {
    let calls = 0;
    const h = company(() => { calls += 1; return { text: "done", toolCalls: [], rawResponseJson: "{}" }; });
    const kickoff = claimNextQueuedRun(h.connection)!;
    h.connection.db.prepare("update goals set status = 'achieved' where id = ?").run(h.goalId);
    await h.execution.executeRun(h.orgId, kickoff.id);
    expect(h.connection.db.prepare("select state, error_message from task_runs where id = ?").get(kickoff.id))
      .toEqual({ state: "superseded", error_message: "Superseded: the task's goal is achieved, so its work stops." });
    expect(h.connection.transaction(() => h.execution.enqueueHeartbeatRuns())).toEqual([]);
    expect(calls).toBe(0);
    h.connection.close();
  });

  test("a running session hears about a goal rewrite before its next step", async () => {
    let followUp: string | undefined;
    let goalId = "";
    const h = company((input, db) => {
      const last = input.messages.at(-1);
      if (last?.role === "tool") {
        followUp = last.followUp;
        return { text: "Re-planned.", toolCalls: [], rawResponseJson: "{}" };
      }
      // Same updated_at on purpose: the notice must follow the content, not the timestamp.
      db.prepare("update goals set title = 'Ship the paid beta.', description = 'Charge from day one.' where id = ?").run(goalId);
      return { text: "Checking messages.", toolCalls: [{ id: "c1", name: "read_messages", arguments: {} }], rawResponseJson: "{}" };
    });
    goalId = h.goalId;
    const kickoff = claimNextQueuedRun(h.connection)!;
    await h.execution.executeRun(h.orgId, kickoff.id);
    expect(followUp).toContain('The goal for this work changed while you were working. It now reads: "Ship the paid beta." — Charge from day one. Re-check your plan against it.');
    h.connection.close();
  });
});
