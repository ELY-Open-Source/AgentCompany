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
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";
import { canonicalMentionHandle } from "../../src/main/services/mention-handles";
import type { AgentTurnResult, ProviderToolTurnInput, ToolCall } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

/**
 * Scripts two distinct agents off the same provider, branching on the
 * instructions (which name the acting agent). The CEO staffs one engineer and
 * @mentions them in #engineering; the engineer, once woken, replies in the same
 * thread — the round trip that makes the company feel alive.
 */
function scriptedTeam(): (input: ProviderToolTurnInput) => Promise<AgentTurnResult> {
  const handle = canonicalMentionHandle("Dana Lee");
  let ceo = 0;
  let dana = 0;
  const ceoScript = [
    { text: "Staffing engineering.", toolCalls: [call("hire_agent", { name: "Dana Lee", role: "Engineer", department: "Engineering" })] },
    { text: "Delegating and pinging.", toolCalls: [
      call("create_task", { title: "Build the booking API", description: "Ship the booking API.", assignee_agent_name: "Dana Lee" }),
      call("send_message", { channel: "engineering", body: `@${handle} you own the booking API — kicking off here.` }),
    ] },
    { text: "Kickoff complete.", toolCalls: [] },
  ];
  return async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
    if ((input.instructions ?? "").includes("Dana Lee")) {
      // Reply inside the thread the CEO started (the prompt carries its id).
      const firstUser = input.messages.find((message) => message.role === "user");
      const threadId = firstUser ? /thread_id="([^"]+)"/.exec(firstUser.text)?.[1] : undefined;
      const turn = dana === 0
        ? { text: "On it.", toolCalls: [call("send_message", { channel: "engineering", body: "On it — booking API design starting now.", ...(threadId ? { thread_id: threadId } : {}) })] }
        : { text: "Replied.", toolCalls: [] };
      dana += 1;
      return { text: turn.text, toolCalls: turn.toolCalls, rawResponseJson: "{}" };
    }
    const turn = ceoScript[ceo] ?? { text: "done", toolCalls: [] };
    ceo += 1;
    return { text: turn.text, toolCalls: turn.toolCalls, rawResponseJson: "{}" };
  };
}

describe("inter-agent reply", () => {
  test("an @mention wakes the teammate, who replies in the same thread", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-reply-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, scriptedTeam());
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const taskExecution = new TaskExecutionService(connection.db, providers);
    const snapshot = new SnapshotService(connection.db);

    let orgId = "";
    connection.transaction(() => {
      orgId = onboarding.bootstrap({
        companyName: "OrbitOps AI",
        companyDescription: "AI-run operations company.",
        employeeName: "Yang",
        workspacePath: "",
        executionMode: "ai_ceo",
        autoApproveHires: true,
        reviewDeliverables: false,
        goalTitle: "Stand up a service business.",
        goalDescription: "Win the first customers.",
        providerKey: "openai",
        providerSecret: "sk-test-key",
        providerModel: "gpt-5.4",
      }).orgId;
    });

    // Run the CEO's kickoff: it hires Dana and @mentions her in #engineering.
    const ceoRun = claimNextQueuedRun(connection);
    await taskExecution.executeRun(ceoRun!.org_id, ceoRun!.id);

    const dana = (connection.db.prepare("select id from agents where org_id = ? and name = 'Dana Lee'").get(orgId) as { id: string });
    expect(dana).toBeTruthy();

    // The @mention woke Dana: a queued chat_mention run was created for her.
    const wake = connection.db.prepare(
      "select id, state, trigger from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention'",
    ).get(orgId, dana.id) as { id: string; state: string; trigger: string } | undefined;
    expect(wake).toMatchObject({ state: "queued", trigger: "chat_mention" });

    // Execute Dana's woken run: she replies in the CEO's thread.
    await taskExecution.executeRun(orgId, wake!.id);

    const engineering = connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'engineering'").get(orgId) as { id: string };
    const messages = snapshot.load().chatMessages.filter((m) => m.orgId === orgId && m.spaceId === engineering.id);
    const senders = new Set(messages.map((m) => m.senderId));
    // Both the CEO and Dana have spoken in #engineering, in one shared thread.
    expect(messages.length).toBe(2);
    expect(senders.size).toBe(2);
    expect(new Set(messages.map((m) => m.threadId)).size).toBe(1);
    expect(messages.some((m) => m.senderId === dana.id && m.bodyMd.includes("On it"))).toBe(true);

    connection.close();
  });
});
