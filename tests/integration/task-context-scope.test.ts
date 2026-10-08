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
import { canonicalMentionHandle } from "../../src/shared/mention-handles";
import type { AgentTurnResult, ProviderToolTurnInput, ToolCall } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

const CHANNEL_NOTE = "unrelated: rotate the staging certificates tonight";

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

describe("task prompt scope", () => {
  test("an ordinary task prompt carries no chat mentions from other work", async () => {
    const handle = canonicalMentionHandle("Dana Lee");
    const danaPrompts: string[] = [];
    let ceo = 0;
    const ceoScript = [
      { text: "Staffing.", toolCalls: [call("hire_agent", { name: "Dana Lee", role: "Engineer", department: "Engineering" })] },
      { text: "Delegating.", toolCalls: [
        call("create_task", { title: "Build the booking API", description: "Ship the booking API.", assignee_agent_name: "Dana Lee" }),
        call("send_message", { channel: "engineering", body: `@${handle} ${CHANNEL_NOTE}` }),
      ] },
      { text: "Done.", toolCalls: [] },
    ];
    const turn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
      if ((input.instructions ?? "").includes("Dana Lee")) {
        const first = input.messages.find((message) => message.role === "user");
        if (first && first.role === "user") danaPrompts.push(first.text);
        return { text: "done", toolCalls: [], rawResponseJson: "{}" };
      }
      const step = ceoScript[ceo] ?? { text: "done", toolCalls: [] };
      ceo += 1;
      return { text: step.text, toolCalls: step.toolCalls, rawResponseJson: "{}" };
    };
    const connection = new DatabaseConnection(join(tmpdir(), `ac-scope-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, turn);
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    connection.transaction(() => {
      orgId = onboarding.bootstrap({
        companyName: "OrbitOps AI", companyDescription: "Ops.", employeeName: "Yang", workspacePath: "",
        executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false,
        goalTitle: "Stand up a service business.", goalDescription: "Win customers.",
        providerKey: "openai", providerSecret: "sk-test-key", providerModel: "gpt-5.4",
      }).orgId;
    });
    const kickoff = claimNextQueuedRun(connection);
    await execution.executeRun(kickoff!.org_id, kickoff!.id);

    const task = connection.db.prepare("select id from tasks where org_id = ? and title = 'Build the booking API'").get(orgId) as { id: string };
    await execution.runTask({ orgId, taskId: task.id });

    expect(danaPrompts).toHaveLength(1);
    expect(danaPrompts[0]).toContain("Build the booking API");
    expect(danaPrompts[0]).not.toContain(CHANNEL_NOTE);
    connection.close();
  });
});
