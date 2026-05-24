import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ApprovalService } from "../../src/main/services/approval-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters, type ProviderAdapterRegistry } from "../../src/main/services/provider-adapters";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { APPROVAL_STATE, RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-task-execution-${randomUUID()}.db`));
}

function openAiProviderId(connection: DatabaseConnection, orgId: string): string {
  return (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'")
    .get(orgId) as { id: string }).id;
}

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("task execution service", () => {
  test("runs an assigned task through the provider gateway", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let capturedPrompt = "";
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        createResponse: async ({ prompt, model }) => {
          capturedPrompt = prompt;
          return {
            text: `executed:${model}`,
            rawResponseJson: JSON.stringify({ id: "resp-task-1" }),
            rateLimitState: null,
          };
        },
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    let providerId = "";
    let taskId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      providerId = openAiProviderId(connection, orgId);
      providers.saveCredential({ orgId, providerId, secret: "sk-live-provider", model: "gpt-5.4" });
      const agentId = organization.createAgent({
        orgId,
        name: "Ada",
        role: "Execution lead",
        department: "Engineering",
        modelProviderId: providerId,
        modelId: "gpt-5.4",
        budgetCents: 10000,
        managerAgentId: null,
      });
      taskId = organization.createTask({
        orgId,
        title: "Draft launch checklist",
        description: "Prepare an auditable checklist for release readiness.",
        status: TASK_STATUS.IN_PROGRESS,
        assigneeAgentId: agentId,
        risk: RISK_LEVEL.MEDIUM,
        projectId: null,
        goalId: null,
        workspaceId: null,
        priority: TASK_PRIORITY.HIGH,
        requiresFilesystem: false,
      });
    });

    const runId = await execution.runTask({ orgId, taskId });
    const state = snapshot.load();
    const run = state.taskRuns.find((item) => item.id === runId);
    const request = state.providerRequests.find((item) => item.id === run?.providerRequestId);

    expect(run).toMatchObject({ taskId, agentId: expect.any(String), providerId, state: "completed", errorMessage: null });
    expect(request).toMatchObject({ providerId, state: "succeeded", responseText: "executed:gpt-5.4" });
    expect(capturedPrompt).toContain("Task: Draft launch checklist");
    expect(capturedPrompt).toContain("Assignee: Ada (Execution lead)");
    expect(state.auditEvents.some((event) => event.entityType === "task_run" && event.action === "completed")).toBe(true);
    connection.close();
  });

  test("requires approved execution approval for high risk tasks", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const approvals = new ApprovalService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        createResponse: async ({ model }) => ({
          text: `executed:${model}`,
          rawResponseJson: JSON.stringify({ id: "resp-task-approved" }),
          rateLimitState: null,
        }),
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    let employeeId = "";
    let taskId = "";
    let approvalId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      const providerId = openAiProviderId(connection, orgId);
      providers.saveCredential({ orgId, providerId, secret: "sk-live-provider", model: "gpt-5.4" });
      const agentId = organization.createAgent({
        orgId,
        name: "Ada",
        role: "Execution lead",
        department: "Engineering",
        modelProviderId: providerId,
        modelId: "gpt-5.4",
        budgetCents: 10000,
        managerAgentId: null,
      });
      taskId = organization.createTask({
        orgId,
        title: "Production deploy",
        description: "Deploy a high-risk release.",
        status: TASK_STATUS.IN_PROGRESS,
        assigneeAgentId: agentId,
        risk: RISK_LEVEL.HIGH,
        projectId: null,
        goalId: null,
        workspaceId: null,
        priority: TASK_PRIORITY.HIGH,
        requiresFilesystem: true,
      });
      approvalId = (connection.db.prepare(`
        select id from approvals
        where org_id = ? and source_entity_type = 'task' and source_entity_id = ?
      `).get(orgId, taskId) as { id: string }).id;
    });

    await expect(execution.runTask({ orgId, taskId })).rejects.toThrow("Approved task execution approval is required.");
    expect(connection.db.prepare("select count(*) as count from task_runs").get()).toEqual({ count: 0 });

    connection.transaction(() => approvals.decide({ orgId, approvalId, state: APPROVAL_STATE.APPROVED, decidedByEmployeeId: employeeId }));
    const runId = await execution.runTask({ orgId, taskId });
    const state = snapshot.load();

    expect(state.approvals.find((approval) => approval.id === approvalId)).toMatchObject({ state: APPROVAL_STATE.APPROVED });
    expect(state.taskRuns.find((run) => run.id === runId)).toMatchObject({ taskId, state: "completed" });
    connection.close();
  });

  test("marks task runs failed when provider execution fails", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        createResponse: async () => {
          throw new Error("provider rejected task");
        },
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    let taskId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      const providerId = openAiProviderId(connection, orgId);
      providers.saveCredential({ orgId, providerId, secret: "sk-live-provider", model: "gpt-5.4" });
      const agentId = organization.createAgent({
        orgId,
        name: "Ada",
        role: "Execution lead",
        department: "Engineering",
        modelProviderId: providerId,
        modelId: "gpt-5.4",
        budgetCents: 10000,
        managerAgentId: null,
      });
      taskId = organization.createTask({
        orgId,
        title: "Draft launch checklist",
        description: "Prepare an auditable checklist for release readiness.",
        status: TASK_STATUS.IN_PROGRESS,
        assigneeAgentId: agentId,
        risk: RISK_LEVEL.MEDIUM,
        projectId: null,
        goalId: null,
        workspaceId: null,
        priority: TASK_PRIORITY.HIGH,
        requiresFilesystem: false,
      });
    });

    await expect(execution.runTask({ orgId, taskId })).rejects.toThrow("provider rejected task");
    const state = snapshot.load();
    const run = state.taskRuns[0];
    const request = state.providerRequests.find((item) => item.id === run?.providerRequestId);

    expect(run).toMatchObject({ taskId, state: "failed", errorMessage: "provider rejected task" });
    expect(request).toMatchObject({ state: "failed", errorMessage: "provider rejected task" });
    expect(state.auditEvents.some((event) => event.entityType === "task_run" && event.action === "failed")).toBe(true);
    connection.close();
  });

  test("requires task assignees to have a model provider", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const execution = new TaskExecutionService(connection.db);
    let orgId = "";
    let taskId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      const agentId = organization.createAgent({
        orgId,
        name: "Ada",
        role: "Execution lead",
        department: "Engineering",
        modelProviderId: null,
        modelId: null,
        budgetCents: 10000,
        managerAgentId: null,
      });
      taskId = organization.createTask({
        orgId,
        title: "Draft launch checklist",
        description: "Prepare an auditable checklist for release readiness.",
        status: TASK_STATUS.IN_PROGRESS,
        assigneeAgentId: agentId,
        risk: RISK_LEVEL.MEDIUM,
        projectId: null,
        goalId: null,
        workspaceId: null,
        priority: TASK_PRIORITY.HIGH,
        requiresFilesystem: false,
      });
    });

    await expect(execution.runTask({ orgId, taskId })).rejects.toThrow("Task assignee requires a model provider.");
    expect(connection.db.prepare("select count(*) as count from task_runs").get()).toEqual({ count: 0 });
    connection.close();
  });
});
