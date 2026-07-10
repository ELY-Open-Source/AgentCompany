import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext, type AgentToolDeps } from "../../src/main/services/agent-tools";
import type { ToolCall } from "../../src/main/services/provider-tool-turn";

function call(name: string): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: {} };
}

describe("complete_goal tool", () => {
  test("the CEO can close their goal; a staff engineer cannot", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-goal-tool-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let staffId = "";
    let goalId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "GoalCorp", employeeName: "Yang", mission: "m", goal: "g" });
      const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
      });
      staffId = organization.createAgent({
        orgId, name: "Dev", role: "Engineer", department: "Engineering",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 10000, managerAgentId: ceoId, roleLevel: "staff",
      });
      goalId = organization.createGoal({ orgId, title: "Ship it", description: "For real.", ownerAgentId: ceoId });
    });
    const deps: AgentToolDeps = { db: connection.db, organization, chat: new ChatService(connection.db) };
    const ctxFor = (agentId: string): AgentToolContext => ({
      orgId, agent: { id: agentId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: goalId, workspace: null,
    });

    expect(dispatchAgentTool(deps, ctxFor(staffId), call("complete_goal"))).toContain("ERROR");
    expect(connection.db.prepare("select status from goals where id = ?").get(goalId)).toEqual({ status: "active" });

    expect(dispatchAgentTool(deps, ctxFor(ceoId), call("complete_goal"))).toContain("achieved");
    expect(connection.db.prepare("select status from goals where id = ?").get(goalId)).toEqual({ status: "achieved" });

    // Idempotent, and honest about it.
    expect(dispatchAgentTool(deps, ctxFor(ceoId), call("complete_goal"))).toContain("already achieved");

    // A task with no goal attached cannot complete anything.
    const noGoalCtx = { ...ctxFor(ceoId), taskGoalId: null };
    expect(dispatchAgentTool(deps, noGoalCtx, call("complete_goal"))).toContain("ERROR");
    connection.close();
  });
});
