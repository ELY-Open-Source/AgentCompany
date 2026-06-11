import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ApprovalService } from "../../src/main/services/approval-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import type { AgentTurnResult, ProviderToolTurnInput } from "../../src/main/services/provider-tool-turn";
import { SkillService } from "../../src/main/services/skill-service";
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
    const fakeToolTurn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
      const first = input.messages[0];
      if (first?.role === "user") capturedPrompt = first.text;
      return { text: "executed:gpt-5.4", toolCalls: [], rawResponseJson: JSON.stringify({ id: "resp-task-1" }) };
    };
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, fakeToolTurn);
    const skills = new SkillService(connection.db, join(tmpdir(), `agentcompany-task-skills-${randomUUID()}`));
    const execution = new TaskExecutionService(connection.db, providers);
    const skillDir = join(tmpdir(), `agentcompany-task-skill-${randomUUID()}`);
    let orgId = "";
    let agentId = "";
    let providerId = "";
    let taskId = "";
    let workspaceId = "";
    let revisionId = "";

    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Release Execution\n\nVerify release readiness and list concrete evidence.\n");
    writeFileSync(join(skillDir, "skill.manifest.json"), JSON.stringify({
      name: "release-execution",
      version: "1.0.0",
      entrypoint: "SKILL.md",
      capabilities: ["release-readiness"],
      required_tools: ["file_search"],
      compatible_models: ["openai/*"],
      risk_level: "medium",
      inputs: { task: "markdown" },
      outputs: { result: "markdown" },
      tests: [],
    }));

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      providerId = openAiProviderId(connection, orgId);
      providers.saveCredential({ orgId, providerId, secret: "sk-live-provider", model: "gpt-5.4" });
      workspaceId = "wsp_task_execution";
      const now = new Date().toISOString();
      connection.db.prepare(`
        insert into workspaces(id, org_id, name, local_path, repo_url, repo_ref, project_id, is_primary, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, null, ?, ?, ?)
      `).run(workspaceId, orgId, "Task Workspace", "C:/work/task", "https://example.com/task.git", "main", 1, now, now);
      agentId = organization.createAgent({
        orgId,
        name: "Ada",
        role: "Execution lead",
        department: "Engineering",
        modelProviderId: providerId,
        modelId: "gpt-5.4",
        budgetCents: 10000,
        managerAgentId: null,
      });
      revisionId = skills.importDirectory({ orgId, directoryPath: skillDir, versionSemver: "1.0.0" });
      const skill = connection.db.prepare("select id from skill_definitions where org_id = ? and slug = ?")
        .get(orgId, "release-execution") as { id: string };
      skills.bind({ orgId, agentId, skillId: skill.id, revisionId });
      taskId = organization.createTask({
        orgId,
        title: "Draft launch checklist",
        description: "Prepare an auditable checklist for release readiness.",
        status: TASK_STATUS.IN_PROGRESS,
        assigneeAgentId: agentId,
        risk: RISK_LEVEL.MEDIUM,
        projectId: null,
        goalId: null,
        workspaceId,
        priority: TASK_PRIORITY.HIGH,
        requiresFilesystem: false,
      });
    });

    const runId = await execution.runTask({ orgId, taskId });
    const state = snapshot.load();
    const run = state.taskRuns.find((item) => item.id === runId);
    const request = state.providerRequests.find((item) => item.id === run?.providerRequestId);
    const skillRuntimeSnapshot = state.skillRuntimeSnapshots.find((item) => item.runId === runId);

    expect(run).toMatchObject({ taskId, agentId: expect.any(String), providerId, state: "completed", errorMessage: null });
    expect(request).toMatchObject({ providerId, workspaceId, state: "succeeded", responseText: "executed:gpt-5.4" });
    expect(skillRuntimeSnapshot).toMatchObject({ agentId, runId });
    expect(run?.executionContextId).toMatch(/^ctx_/);
    expect(run?.serviceIdentityId).toMatch(/^sid_/);
    expect(JSON.parse(run?.workspaceMountJson ?? "[]")).toEqual([expect.objectContaining({ workspaceId, mode: "read_only" })]);
    expect(JSON.parse(run?.secretScopeJson ?? "{}")).toMatchObject({ providerIds: [providerId], credentialAccess: "provider_runtime_only" });
    expect(skillRuntimeSnapshot?.compiledPrompt).toContain("Verify release readiness");
    expect(skillRuntimeSnapshot?.sourceRevisionIds).toContain(revisionId);
    expect(capturedPrompt).toContain("Task: Draft launch checklist");
    expect(capturedPrompt).toContain("Assignee: Ada (Execution lead)");
    expect(capturedPrompt).toContain("Workspace: Task Workspace");
    expect(capturedPrompt).toContain("Execution context:");
    expect(capturedPrompt).toContain("Secret scope:");
    expect(capturedPrompt).toContain("Skill runtime:");
    expect(capturedPrompt).toContain("Tool allowlist:");
    expect(state.auditEvents.some((event) => event.entityType === "task_run" && event.action === "completed")).toBe(true);
    rmSync(skillDir, { recursive: true, force: true });
    connection.close();
  });

  test("requires approved execution approval for high risk tasks", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const approvals = new ApprovalService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const fakeToolTurn = async (): Promise<AgentTurnResult> => ({
      text: "executed:gpt-5.4",
      toolCalls: [],
      rawResponseJson: JSON.stringify({ id: "resp-task-approved" }),
    });
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, fakeToolTurn);
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    let employeeId = "";
    let taskId = "";
    let approvalId = "";
    let workspaceId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
        executionMode: "ai_cofounder",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      const providerId = openAiProviderId(connection, orgId);
      providers.saveCredential({ orgId, providerId, secret: "sk-live-provider", model: "gpt-5.4" });
      workspaceId = "wsp_production";
      const now = new Date().toISOString();
      connection.db.prepare(`
        insert into workspaces(id, org_id, name, local_path, repo_url, repo_ref, project_id, is_primary, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, null, ?, ?, ?)
      `).run(workspaceId, orgId, "Production", "C:/work/production", "https://example.com/production.git", "main", 1, now, now);
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
        workspaceId,
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
    expect(JSON.parse(state.taskRuns.find((run) => run.id === runId)?.workspaceMountJson ?? "[]"))
      .toEqual([expect.objectContaining({ workspaceId, mode: "read_write" })]);
    connection.close();
  });

  test("marks task runs failed when provider execution fails", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const fakeToolTurn = async (): Promise<AgentTurnResult> => {
      throw new Error("provider rejected task");
    };
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, fakeToolTurn);
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
    const request = state.providerRequests.find((item) => item.state === "failed");

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
