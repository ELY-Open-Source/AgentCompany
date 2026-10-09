import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { ChatService } from "../../src/main/services/chat-service";
import { cancelQueuedRun } from "../../src/main/services/run-cancel";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("cancelling a queued run", () => {
  test("stops it before it starts without spending the retry budget, and closes a chat reply it was for", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-run-cancel-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault);
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    let orgId = "";
    connection.transaction(() => {
      orgId = onboarding.bootstrap({
        companyName: "FlowPilot", companyDescription: "CSM analytics.", employeeName: "Yang", workspacePath: "",
        executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false,
        goalTitle: "Ship the MVP.", goalDescription: "A working product.",
        providerKey: "openai", providerSecret: "sk-test-key", providerModel: "gpt-5.4",
      }).orgId;
    });
    const kickoff = connection.db.prepare("select id from task_runs where state = 'queued'").get() as { id: string };
    connection.transaction(() => cancelQueuedRun(connection.db, orgId, kickoff.id));
    expect(connection.db.prepare("select state, error_message from task_runs where id = ?").get(kickoff.id))
      .toEqual({ state: "stopped", error_message: "Cancelled before it started." });
    expect(() => cancelQueuedRun(connection.db, orgId, kickoff.id)).toThrow("That run is no longer queued.");

    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const dm = (connection.db.prepare("select id from chat_spaces where org_id = ? and space_type = 'direct'").get(orgId) as { id: string }).id;
    connection.transaction(() => new ChatService(connection.db).sendMessage({ orgId, spaceId: dm, threadId: null, senderType: "employee", senderId: employeeId, bodyMd: "Status?", attachmentFileIds: [] }));
    const wake = connection.db.prepare("select id, task_id from task_runs where trigger = 'chat_mention'").get() as { id: string; task_id: string };
    connection.transaction(() => cancelQueuedRun(connection.db, orgId, wake.id));
    expect(connection.db.prepare("select status from tasks where id = ?").get(wake.task_id)).toEqual({ status: "done" });
    connection.close();
  });
});
