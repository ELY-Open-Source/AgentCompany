import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";
import type { AgentTurnResult, ProviderToolTurnInput } from "../../src/main/services/provider-tool-turn";
import { answeringModelCheck } from "../helpers/model-check";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("agent model", () => {
  test("an agent's own model overrides the provider default in the call, the prompt and the request record", async () => {
    const models: string[] = [];
    let prompt = "";
    const turn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
      models.push(input.model);
      const first = input.messages[0];
      if (first?.role === "user") prompt = first.text;
      return { text: "done", toolCalls: [], rawResponseJson: "{}" };
    };
    const connection = new DatabaseConnection(join(tmpdir(), `ac-model-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, answeringModelCheck(turn));
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    const tasks: Record<string, string> = {};
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      providers.saveCredential({ orgId, providerId, secret: "sk-test", model: "gpt-5.4" });
      for (const [name, modelId] of [["Ada", "gpt-5.5-mini"], ["Bo", null]] as const) {
        const agentId = organization.createAgent({ orgId, name, role: "Engineer", department: "Engineering", modelProviderId: providerId, modelId, budgetCents: 1000, managerAgentId: null });
        tasks[name] = organization.createTask({ orgId, title: `${name} work`, description: "d", status: TASK_STATUS.IN_PROGRESS, assigneeAgentId: agentId, risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false });
      }
    });
    const adaRun = await execution.runTask({ orgId, taskId: tasks.Ada });
    expect(models.at(-1)).toBe("gpt-5.5-mini");
    expect(prompt).toContain("gpt-5.5-mini");
    expect(connection.db.prepare("select model from provider_requests where task_run_id = ?").get(adaRun)).toEqual({ model: "gpt-5.5-mini" });
    await execution.runTask({ orgId, taskId: tasks.Bo });
    expect(models.at(-1)).toBe("gpt-5.4");
    connection.close();
  });

  test("an agent on Azure cannot silently switch away from the provider's deployment", async () => {
    const turn = async (): Promise<AgentTurnResult> => ({ text: "done", toolCalls: [], rawResponseJson: "{}" });
    const connection = new DatabaseConnection(join(tmpdir(), `ac-model-az-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, answeringModelCheck(turn));
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    let taskId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'azure-openai'").get(orgId) as { id: string }).id;
      connection.db.prepare("update providers set model = 'gpt-5.4', enabled = 1, auth_state = 'configured', credential_id = 'cred_az' where id = ?").run(providerId);
      const agentId = organization.createAgent({ orgId, name: "Ada", role: "Engineer", department: "Engineering", modelProviderId: providerId, modelId: "gpt-5.4-mini", budgetCents: 1000, managerAgentId: null });
      taskId = organization.createTask({ orgId, title: "Work", description: "d", status: TASK_STATUS.IN_PROGRESS, assigneeAgentId: agentId, risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false });
    });
    await expect(execution.runTask({ orgId, taskId })).rejects.toThrow('Azure OpenAI calls the deployment configured on the provider; this agent asks for "gpt-5.4-mini".');
    connection.close();
  });

  test("a session keeps the model and account it started with", async () => {
    const models: string[] = [];
    let onTurn = (_turn: number) => {};
    let lastPrompt = "";
    const turn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
      models.push(input.model);
      const first = input.messages[0];
      if (first?.role === "user") lastPrompt = first.text;
      onTurn(models.length);
      return models.length < 3
        ? { text: "Working.", toolCalls: [{ id: `c${models.length}`, name: "read_messages", arguments: {} }], rawResponseJson: "{}" }
        : { text: "done", toolCalls: [], rawResponseJson: "{}" };
    };
    const connection = new DatabaseConnection(join(tmpdir(), `ac-model-pin-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, answeringModelCheck(turn));
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    let taskId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      providers.saveCredential({ orgId, providerId, secret: "sk-test", model: "gpt-5.4" });
      const agentId = organization.createAgent({ orgId, name: "Ada", role: "Engineer", department: "Engineering", modelProviderId: providerId, modelId: null, budgetCents: 1000, managerAgentId: null });
      taskId = organization.createTask({ orgId, title: "Work", description: "d", status: TASK_STATUS.IN_PROGRESS, assigneeAgentId: agentId, risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false });
    });
    onTurn = (count) => { if (count === 1) connection.db.prepare("update providers set model = 'gpt-6' where id = ?").run(providerId); };
    await execution.runTask({ orgId, taskId });
    expect(models).toEqual(["gpt-5.4", "gpt-5.4", "gpt-5.4"]);

    // A resumed run builds its prompt and calls with the model it was pinned to, not today's configuration.
    models.length = 0;
    onTurn = () => {};
    const resumedId = (connection.db.prepare("select id from task_runs where task_id = ?").get(taskId) as { id: string }).id;
    connection.db.prepare("update task_runs set state = 'running', completed_at = null where id = ?").run(resumedId);
    await execution.executeRun(orgId, resumedId);
    expect(models).toEqual(["gpt-5.4", "gpt-5.4", "gpt-5.4"]);
    expect(lastPrompt).toContain("Provider: OpenAI gpt-5.4");

    models.length = 0;
    onTurn = (count) => { if (count === 1) connection.db.prepare("update providers set credential_id = 'cred_reconnected' where id = ?").run(providerId); };
    await expect(execution.runTask({ orgId, taskId })).rejects.toThrow("The provider's account was reconnected during this session");
    expect(models).toEqual(["gpt-6"]);
    connection.close();
  });
});
