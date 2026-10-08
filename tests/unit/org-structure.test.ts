import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

describe("org structure", () => {
  test("the CEO hires titled officers who build their own departments - a three-level chain", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-org-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
      });
    });
    const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
    const ctx = (agentId: string): AgentToolContext => ({
      orgId,
      agent: { id: agentId, modelProviderId: providerId, modelId: "gpt-5.4" },
      taskProjectId: null,
      taskGoalId: null, taskId: null, sourceThreadId: null,
      workspace: null,
    });

    // Level 2: the CEO hires a chief officer with rank and title.
    const hiredCto = connection.transaction(() =>
      dispatchAgentTool(deps, ctx(ceoId), call("hire_agent", {
        name: "Ava Sun", role: "Head of Engineering", title: "CTO", department: "Engineering", seniority: "director",
      })));
    expect(hiredCto).toContain("Hired Ava Sun as CTO (director) in Engineering");
    const cto = connection.db.prepare("select id, title, role_level, manager_agent_id from agents where org_id = ? and name = 'Ava Sun'")
      .get(orgId) as { id: string; title: string; role_level: string; manager_agent_id: string };
    expect(cto).toMatchObject({ title: "CTO", role_level: "director", manager_agent_id: ceoId });

    // Level 3: the officer hires into their own department.
    const hiredManager = connection.transaction(() =>
      dispatchAgentTool(deps, ctx(cto.id), call("hire_agent", {
        name: "Ken Ito", role: "Backend Engineer", department: "Engineering", seniority: "lead", title: "Engineering Manager",
      })));
    expect(hiredManager).toContain("(lead)");
    const manager = connection.db.prepare("select role_level, manager_agent_id, title from agents where org_id = ? and name = 'Ken Ito'")
      .get(orgId) as { role_level: string; manager_agent_id: string; title: string };
    expect(manager).toMatchObject({ role_level: "lead", manager_agent_id: cto.id, title: "Engineering Manager" });

    // Defaults: seniority omitted means staff; c_suite is not hireable.
    connection.transaction(() =>
      dispatchAgentTool(deps, ctx(cto.id), call("hire_agent", { name: "Ren Park", role: "Engineer", department: "Engineering" })));
    const staff = connection.db.prepare("select role_level from agents where org_id = ? and name = 'Ren Park'").get(orgId) as { role_level: string };
    expect(staff.role_level).toBe("staff");
    const rejected = dispatchAgentTool(deps, ctx(ceoId), call("hire_agent", {
      name: "Imposter", role: "CEO 2", department: "Executive", seniority: "c_suite",
    }));
    expect(rejected).toContain("ERROR");
    expect(rejected).toContain("reserved for the CEO");

    // The org now has the real-company departments to grow into.
    const departments = (connection.db.prepare("select department_name from hiring_policies where org_id = ? order by department_name").all(orgId) as Array<{ department_name: string }>)
      .map((row) => row.department_name);
    expect(departments).toContain("Finance");
    expect(departments).toContain("Sales");
    connection.close();
  });
});
