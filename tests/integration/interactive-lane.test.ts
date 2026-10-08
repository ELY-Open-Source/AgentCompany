import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { describe, expect, test, vi } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { dispatchAgentTool } from "../../src/main/services/agent-tools";
import { claimNextQueuedRun, startTaskQueueWorker } from "../../src/main/app/task-queue-worker";
import type { AgentTurnResult, ProviderToolTurnInput, ToolCall } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

function turn(text: string, toolCalls: ToolCall[] = []): AgentTurnResult {
  return { text, toolCalls, rawResponseJson: "{}" };
}

interface Deferred {
  promise: Promise<AgentTurnResult>;
  resolve: (value: AgentTurnResult) => void;
}

function deferred(): Deferred {
  let resolve!: (value: AgentTurnResult) => void;
  const promise = new Promise<AgentTurnResult>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("interactive execution lane", () => {
  test("the founder's wake executes concurrently instead of queueing behind a long autonomous run", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-lane-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let danaId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      connection.db.prepare("update providers set enabled = 1 where id = ? and org_id = ?").run(providerId, orgId);
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
      });
      danaId = organization.createAgent({
        orgId, name: "Dana", role: "Engineer", department: "Engineering",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: ceoId,
      });
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const chat = new ChatService(connection.db);

    // Dana's autonomous run blocks on this gate — the "30-minute engineering
    // run" in miniature. The CEO's interactive run completes normally.
    const danaGate = deferred();
    let ceoReplied = false;
    const script = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
      const prompt = input.messages.find((message) => message.role === "user")?.text ?? "";
      if (prompt.includes("Grind through the migration backlog")) return danaGate.promise;
      const threadId = /thread_id="([^"]+)"/.exec(prompt)?.[1];
      if (prompt.includes("Add headcount") && threadId && !ceoReplied) {
        ceoReplied = true;
        return turn("Answering.", [call("send_message", { to: "Yang", body: "On it — hiring plan coming today.", thread_id: threadId })]);
      }
      return turn("done");
    };
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, script);
    providers.saveCredential({ orgId, providerId, secret: "sk-test-key", model: "gpt-5.4" });
    const taskExecution = new TaskExecutionService(connection.db, providers);

    // Older autonomous work: the CEO DMs Dana, waking her.
    dispatchAgentTool({ db: connection.db, organization, chat }, {
      orgId, agent: { id: ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    }, call("send_message", { to: "Dana", body: "Grind through the migration backlog." }));

    // Newer interactive work: the founder DMs the CEO.
    const spaceId = chat.ensureDirectSpace(orgId, { type: "employee", id: employeeId }, { type: "agent", id: ceoId });
    chat.sendMessage({
      orgId, spaceId, threadId: null, senderType: "employee", senderId: employeeId,
      bodyMd: "Add headcount wherever you need — your call.", attachmentFileIds: [],
    });

    const stopWorker = startTaskQueueWorker({
      connection,
      mainWindow: { isDestroyed: () => true } as unknown as BrowserWindow,
      intervalMs: 25,
      taskExecution,
    });
    try {
      // The CEO's reply lands while Dana's run is still in flight: the
      // interactive slot did not wait for the autonomous slot.
      await vi.waitFor(() => {
        const reply = connection.db.prepare(
          "select id from chat_messages where org_id = ? and sender_type = 'agent' and sender_id = ? and space_id = ?",
        ).get(orgId, ceoId, spaceId);
        expect(reply).toBeTruthy();
      }, { timeout: 3000, interval: 50 });

      const danaRun = connection.db.prepare(
        "select state from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention'",
      ).get(orgId, danaId) as { state: string };
      expect(danaRun.state).toBe("running");

      // Release the long run; the autonomous slot completes it.
      danaGate.resolve(turn("Backlog ground through."));
      await vi.waitFor(() => {
        const state = (connection.db.prepare(
          "select state from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention'",
        ).get(orgId, danaId) as { state: string }).state;
        expect(state).toBe("completed");
      }, { timeout: 3000, interval: 50 });
    } finally {
      stopWorker();
      connection.close();
    }
  });

  test("a founder message probes through a provider cooldown and a served request lifts the park", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-probe-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      connection.db.prepare("update providers set enabled = 1 where id = ? and org_id = ?").run(providerId, orgId);
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
      });
      organization.createAgent({
        orgId, name: "Dana", role: "Engineer", department: "Engineering",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: ceoId,
      });
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const chat = new ChatService(connection.db);

    let ceoReplied = false;
    const script = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
      const prompt = input.messages.find((message) => message.role === "user")?.text ?? "";
      if (prompt.includes("Grind through the migration backlog")) {
        throw new Error("The engine is currently overloaded, please try again later");
      }
      const threadId = /thread_id="([^"]+)"/.exec(prompt)?.[1];
      if (prompt.includes("Are we blocked") && threadId && !ceoReplied) {
        ceoReplied = true;
        return turn("Answering.", [call("send_message", { to: "Yang", body: "Not blocked — one hiccup, already moving.", thread_id: threadId })]);
      }
      return turn("done");
    };
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, script);
    providers.saveCredential({ orgId, providerId, secret: "sk-test-key", model: "gpt-5.4" });
    const taskExecution = new TaskExecutionService(connection.db, providers);

    // Autonomous work that will trip the transient failure and park the provider.
    dispatchAgentTool({ db: connection.db, organization, chat }, {
      orgId, agent: { id: ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    }, call("send_message", { to: "Dana", body: "Grind through the migration backlog." }));

    const stopWorker = startTaskQueueWorker({
      connection,
      mainWindow: { isDestroyed: () => true } as unknown as BrowserWindow,
      intervalMs: 25,
      taskExecution,
    });
    try {
      await vi.waitFor(() => {
        expect(taskExecution.cooledProviderIds()).toEqual([providerId]);
      }, { timeout: 3000, interval: 25 });

      // The founder speaks INTO the cooldown; the interactive lane probes through.
      const spaceId = chat.ensureDirectSpace(orgId, { type: "employee", id: employeeId }, { type: "agent", id: ceoId });
      chat.sendMessage({
        orgId, spaceId, threadId: null, senderType: "employee", senderId: employeeId,
        bodyMd: "Are we blocked on anything?", attachmentFileIds: [],
      });
      await vi.waitFor(() => {
        const reply = connection.db.prepare(
          "select id from chat_messages where org_id = ? and sender_type = 'agent' and sender_id = ? and space_id = ?",
        ).get(orgId, ceoId, spaceId);
        expect(reply).toBeTruthy();
      }, { timeout: 3000, interval: 25 });

      // The served probe is proof of health: the park lifted for everyone.
      expect(taskExecution.cooledProviderIds()).toEqual([]);
    } finally {
      stopWorker();
      connection.close();
    }
  });

  test("a spent probe blocks further interactive claims until the window expires", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-probe-spent-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      connection.db.prepare("update providers set enabled = 1 where id = ? and org_id = ?").run(providerId, orgId);
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
      });
      organization.createAgent({
        orgId, name: "Dana", role: "Engineer", department: "Engineering",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: ceoId,
      });
    });
    const chat = new ChatService(connection.db);
    const alwaysOverloaded = async (): Promise<AgentTurnResult> => {
      throw new Error("The engine is currently overloaded, please try again later");
    };
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, alwaysOverloaded);
    providers.saveCredential({ orgId, providerId, secret: "sk-test-key", model: "gpt-5.4" });
    const taskExecution = new TaskExecutionService(connection.db, providers);
    const wakeDana = () => dispatchAgentTool({ db: connection.db, organization, chat }, {
      orgId, agent: { id: ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    }, call("send_message", { to: "Dana", body: "Grind through the migration backlog." }));

    wakeDana();
    const first = claimNextQueuedRun(connection)!;
    await taskExecution.executeRun(first.org_id, first.id).catch(() => {});
    expect(taskExecution.cooledProviderIds()).toEqual([providerId]);
    // The park window opens with one probe available to the interactive lane.
    expect(taskExecution.interactiveCooledProviderIds()).toEqual([]);

    taskExecution.noteInteractiveProbe(providerId);
    expect(taskExecution.interactiveCooledProviderIds()).toEqual([providerId]);

    // A failed probe re-arms the park WITHOUT restoring the probe: no hammering.
    wakeDana();
    const second = claimNextQueuedRun(connection)!;
    await taskExecution.executeRun(second.org_id, second.id).catch(() => {});
    expect(taskExecution.interactiveCooledProviderIds()).toEqual([providerId]);
    connection.close();
  });
});
