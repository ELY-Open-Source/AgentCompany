import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { KnowledgeService } from "../../src/main/services/knowledge-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";
import { canonicalMentionHandle } from "../../src/shared/mention-handles";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";
import type { AgentTurnResult, ProviderToolTurnInput, ToolCall } from "../../src/main/services/provider-tool-turn";
import { answeringModelCheck } from "../helpers/model-check";

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
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, answeringModelCheck(turn));
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
    new KnowledgeService(connection.db).create({ orgId, topic: "Booking storage", category: "decision", content: "Bookings live in Postgres.", importance: "high", sourceType: "employee", sourceId: null, scopeType: "organization", scopeId: null, validUntil: null, supersedesId: null });
    new KnowledgeService(connection.db).create({ orgId, topic: "Offsite venue", category: "fact", content: "Lisbon in May.", importance: "low", sourceType: "employee", sourceId: null, scopeType: "organization", scopeId: null, validUntil: null, supersedesId: null });
    await execution.runTask({ orgId, taskId: task.id });

    const danaId = (connection.db.prepare("select id from agents where org_id = ? and name = 'Dana Lee'").get(orgId) as { id: string }).id;
    connection.db.prepare("update task_runs set state = 'running' where agent_id = ? and trigger = 'chat_mention'").run(danaId);
    await expect(execution.runTask({ orgId, taskId: task.id })).rejects.toThrow("This agent is already working on");
    const busyTaskId = (connection.db.prepare("select task_id from task_runs where agent_id = ? and state = 'running'").get(danaId) as { task_id: string }).task_id;
    expect(() => new OrganizationService(connection.db).deleteTask({ orgId, taskId: busyTaskId })).toThrow("has a run in progress");
    expect(connection.db.prepare("select count(*) as n from task_runs where task_id = ? and state = 'running'").get(busyTaskId)).toEqual({ n: 1 });
    expect(danaPrompts).toHaveLength(1);
    expect(danaPrompts[0]).toContain("Build the booking API");
    expect(danaPrompts[0]).toContain("- Booking storage [decision, high");
    expect(danaPrompts[0]).not.toContain("Offsite venue");
    expect(danaPrompts[0]).not.toContain(CHANNEL_NOTE);
    connection.close();
  });

  test("a queued run whose task was reassigned fails instead of running as someone else", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-reassign-${randomUUID()}.db`));
    let calls = 0;
    const turn = async (): Promise<AgentTurnResult> => {
      calls += 1;
      return { text: "done", toolCalls: [], rawResponseJson: "{}" };
    };
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, answeringModelCheck(turn));
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const organization = new OrganizationService(connection.db);
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    let ceoId = "";
    connection.transaction(() => {
      const summary = onboarding.bootstrap({
        companyName: "OrbitOps AI", companyDescription: "Ops.", employeeName: "Yang", workspacePath: "",
        executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false,
        goalTitle: "Stand up a service business.", goalDescription: "Win customers.",
        providerKey: "openai", providerSecret: "sk-test-key", providerModel: "gpt-5.4",
      });
      orgId = summary.orgId;
      ceoId = summary.ceoAgentId;
    });
    const providerId = (connection.db.prepare("select model_provider_id as id from agents where id = ?").get(ceoId) as { id: string }).id;
    const otherId = organization.createAgent({
      orgId, name: "Ops Lead", role: "Ops", department: "Operations",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: ceoId,
    });
    const kickoff = claimNextQueuedRun(connection)!;
    const taskId = (connection.db.prepare("select task_id from task_runs where id = ?").get(kickoff.id) as { task_id: string }).task_id;
    connection.db.prepare("update tasks set assignee_agent_id = ? where id = ?").run(otherId, taskId);

    await execution.executeRun(orgId, kickoff.id);
    expect(connection.db.prepare("select state, error_message like '%reassigned%' as reassigned from task_runs where id = ?").get(kickoff.id))
      .toEqual({ state: "superseded", reassigned: 1 });
    expect(calls).toBe(0);
    connection.close();
  });

  test("a manual write run waits while another run is changing the same workspace", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-wsplock-${randomUUID()}.db`));
    const turn = async (): Promise<AgentTurnResult> => ({ text: "done", toolCalls: [], rawResponseJson: "{}" });
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, answeringModelCheck(turn));
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const organization = new OrganizationService(connection.db);
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    let ceoId = "";
    connection.transaction(() => {
      const summary = onboarding.bootstrap({
        companyName: "OrbitOps AI", companyDescription: "Ops.", employeeName: "Yang", workspacePath: "",
        executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false,
        goalTitle: "Stand up a service business.", goalDescription: "Win customers.",
        providerKey: "openai", providerSecret: "sk-test-key", providerModel: "gpt-5.4",
      });
      orgId = summary.orgId;
      ceoId = summary.ceoAgentId;
    });
    const providerId = (connection.db.prepare("select model_provider_id as id from agents where id = ?").get(ceoId) as { id: string }).id;
    let busyTask = "";
    let waitingTask = "";
    connection.transaction(() => {
      const workspaceId = organization.createWorkspace({ orgId, name: "repo", localPath: tmpdir(), projectId: null });
      const engineerId = organization.createAgent({
        orgId, name: "Builder", role: "Engineer", department: "Engineering",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: ceoId,
      });
      const make = (title: string, assignee: string) => organization.createTask({
        orgId, title, description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: assignee,
        risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: true,
      });
      busyTask = make("Refactor storage", engineerId);
      waitingTask = make("Bump deps", ceoId);
    });
    const kickoff = claimNextQueuedRun(connection)!;
    connection.db.prepare("update task_runs set task_id = ?, agent_id = (select assignee_agent_id from tasks where id = ?) where id = ?")
      .run(busyTask, busyTask, kickoff.id);

    await expect(execution.runTask({ orgId, taskId: waitingTask })).rejects.toThrow('"Refactor storage" is changing this workspace right now');
    connection.db.prepare("update tasks set title = '' where id = ?").run(busyTask);
    await expect(execution.runTask({ orgId, taskId: waitingTask })).rejects.toThrow("is changing this workspace right now");
    connection.close();
  });
});
