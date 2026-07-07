import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import type { AgentTurnResult, ProviderToolTurnInput } from "../../src/main/services/provider-tool-turn";
import { ConnectorGrantsService } from "../../src/main/services/composio/connector-grants";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";
import { buildAgentInstructions, type TaskExecutionAgentRow } from "../../src/main/services/task-prompts";

function agentRow(overrides: Partial<TaskExecutionAgentRow>): TaskExecutionAgentRow {
  return {
    id: "agt_1",
    name: "Ava",
    role: "Engineer",
    department: "Engineering",
    title: "",
    role_level: "staff",
    model_provider_id: "prv_1",
    model_id: "gpt-5.4",
    manager_agent_id: "agt_ceo",
    ...overrides,
  };
}

describe("agent instructions", () => {
  test("the CEO is briefed on its grant authority over connectors and skills", () => {
    const text = buildAgentInstructions({
      agent: agentRow({ name: "CEO", role: "CEO", role_level: "c_suite", manager_agent_id: null }),
      companyName: "OrbitOps",
      isCeo: true,
      hasReports: false,
      connectorNames: ["GitHub", "Slack"],
      language: "en",
    });
    expect(text).toContain("every connected service and every company skill");
    expect(text).toContain("grant_connector");
    expect(text).toContain("grant_skill");
    expect(text).toContain("grant before you assign");
    expect(text).toContain("GitHub, Slack");
    expect(text).toContain("You run this company");
  });

  test("staff with grants are told exactly which services they carry", () => {
    const text = buildAgentInstructions({
      agent: agentRow({}),
      companyName: "OrbitOps",
      isCeo: false,
      hasReports: false,
      connectorNames: ["Stripe"],
      language: "en",
    });
    expect(text).toContain("Connected external services you carry in this run: Stripe");
    expect(text).toContain("composio_ prefix");
    expect(text).toContain("list_connectors");
    expect(text).toContain("list_skills");
    expect(text).not.toContain("You run this company");
  });

  test("staff without grants are pointed at the CEO for access", () => {
    const text = buildAgentInstructions({
      agent: agentRow({}),
      companyName: "OrbitOps",
      isCeo: false,
      hasReports: false,
      connectorNames: [],
      language: "en",
    });
    expect(text).toContain("You currently hold no connector grants");
    expect(text).toContain("message the CEO");
    expect(text).not.toContain("grant before you assign");
  });

  test("Chinese app language directs agents to work in Chinese", () => {
    const zh = buildAgentInstructions({
      agent: agentRow({}),
      companyName: "OrbitOps",
      isCeo: false,
      hasReports: false,
      connectorNames: [],
      language: "zh",
    });
    expect(zh).toContain("公司的工作语言是简体中文");
    const en = buildAgentInstructions({
      agent: agentRow({}),
      companyName: "OrbitOps",
      isCeo: false,
      hasReports: false,
      connectorNames: [],
      language: "en",
    });
    expect(en).not.toContain("简体中文");
  });
});

describe("agent instruction wiring", () => {
  const testVault = {
    encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
    decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
  };

  test("a manager-less staff hire is not the CEO, and carries its granted toolkit by name", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-instr-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let capturedInstructions = "";
    const fakeToolTurn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
      capturedInstructions = input.instructions ?? "";
      return { text: "done", toolCalls: [], rawResponseJson: JSON.stringify({ id: "resp-1" }) };
    };
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, fakeToolTurn);
    const execution = new TaskExecutionService(connection.db, providers);

    let orgId = "";
    let agentId = "";
    let taskId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g",
      });
      const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      providers.saveCredential({ orgId, providerId, secret: "sk-test", model: "gpt-5.4" });
      agentId = organization.createAgent({
        orgId, name: "Ada", role: "Engineer", department: "Engineering",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: null,
      });
      const now = new Date().toISOString();
      connection.db.prepare(`
        insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, auth_config_id, status, created_at, updated_at)
        values ('ca_github', ?, 'github', 'GitHub', 'ac_github', 'ACTIVE', ?, ?)
      `).run(orgId, now, now);
      new ConnectorGrantsService(connection.db).grant({
        orgId, agentId, toolkitSlug: "github", grantedByType: "employee", grantedById: null,
      });
      taskId = organization.createTask({
        orgId, title: "Ship it", description: "d", status: TASK_STATUS.IN_PROGRESS,
        assigneeAgentId: agentId, risk: RISK_LEVEL.LOW, projectId: null, goalId: null,
        workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
      });
    });

    await execution.runTask({ orgId, taskId });

    expect(capturedInstructions).not.toContain("You run this company");
    expect(capturedInstructions).toContain("Connected external services you carry in this run: GitHub");
    expect(capturedInstructions).toContain("list_connectors");

    // Switching the app language redirects the whole company to Chinese.
    organization.updateUiPreferences({ language: "zh" });
    connection.db.prepare("update task_runs set state = 'failed' where org_id = ?").run(orgId);
    await execution.runTask({ orgId, taskId });
    expect(capturedInstructions).toContain("公司的工作语言是简体中文");
  });
});
