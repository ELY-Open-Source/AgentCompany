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

describe("run journal", () => {
  test("a later session on the task sees what earlier sessions did and where the last one failed", async () => {
    const prompts: string[] = [];
    let session = 0;
    const turn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
      const first = input.messages[0];
      if (first?.role !== "user") throw new Error("The run must open with the task prompt.");
      if (input.messages.length === 1) {
        prompts.push(first.text);
        session += 1;
        if (session === 1) {
          return {
            text: "Working.",
            toolCalls: [
              { id: "c1", name: "send_message", arguments: { channel: "general", body: "Kickoff: we ship the MVP." } },
              { id: "c2", name: "read_messages", arguments: {} },
              { id: "c3", name: "update_task_status", arguments: { task_id: "tsk_missing", status: "in_progress" } },
            ],
            rawResponseJson: "{}",
          };
        }
        return { text: "Continuing.", toolCalls: [], rawResponseJson: "{}" };
      }
      throw new Error("Provider dropped the connection mid-run");
    };
    const connection = new DatabaseConnection(join(tmpdir(), `ac-journal-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault, answeringModelCheck(turn));
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
    const kickoff = claimNextQueuedRun(connection)!;
    await expect(execution.executeRun(orgId, kickoff.id)).rejects.toThrow("Provider dropped the connection mid-run");

    expect(connection.transaction(() => execution.enqueueHeartbeatRuns())).toHaveLength(1);
    const retry = claimNextQueuedRun(connection)!;
    await execution.executeRun(orgId, retry.id);

    expect(prompts[0]).not.toContain("Earlier sessions on this task");
    expect(prompts[1]).toContain("Earlier sessions on this task already made these calls; each shows its result. Do not redo the ones that succeeded; retry or fix only what failed:");
    expect(prompts[1]).toContain('- update_task_status({"task_id":"tsk_missing","status":"in_progress"}) -> ERROR: Task was not found.');
    expect(prompts[1]).toMatch(/- send_message\(\{"channel":"general","body":"Kickoff: we ship the MVP\."\}\) -> /);
    expect(prompts[1]).not.toContain("- read_messages(");
    expect(prompts[1]).toContain("The last session on this task failed with: Provider dropped the connection mid-run.");
    connection.close();
  });
});
