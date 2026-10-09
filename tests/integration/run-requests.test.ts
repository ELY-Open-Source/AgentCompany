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
import { requestsForRun } from "../../src/main/services/provider-request-store";
import type { AgentTurnResult, ProviderToolTurnInput } from "../../src/main/services/provider-tool-turn";
import { answeringModelCheck } from "../helpers/model-check";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("a run's model calls", () => {
  test("every call a run made is listed in order with its purpose, including the turn that failed", async () => {
    let turns = 0;
    const turn = async (_input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
      turns += 1;
      if (turns === 1) return { text: "Checking in.", toolCalls: [{ id: "c1", name: "company_status", arguments: {} }], rawResponseJson: "{}" };
      throw new Error("Provider overloaded");
    };
    const connection = new DatabaseConnection(join(tmpdir(), `ac-run-requests-${randomUUID()}.db`));
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
    const runId = claimNextQueuedRun(connection)!.id;
    await expect(execution.executeRun(orgId, runId)).rejects.toThrow();
    expect(requestsForRun(connection.db, orgId, runId).map((request) => [request.purpose, request.state])).toEqual([
      ["model_check", "succeeded"],
      ["agent_turn", "succeeded"],
      ["agent_turn", "failed"],
    ]);
    connection.close();
  });
});
