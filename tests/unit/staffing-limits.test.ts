import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";

describe("staffing limits on edits", () => {
  test("moving an agent or raising its budget obeys the same department limits as hiring", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-staffing-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    });
    connection.db.prepare("update hiring_policies set max_headcount = 1, monthly_budget_limit_cents = 5000 where org_id = ? and department_name = 'Design'").run(orgId);
    connection.db.prepare("update hiring_policies set monthly_budget_limit_cents = 3000 where org_id = ? and department_name = 'Sales'").run(orgId);
    const hire = (name: string, department: string, budgetCents: number) => organization.createAgent({
      orgId, name, role: "Staff", department, modelProviderId: null, modelId: null, budgetCents, managerAgentId: null,
    });
    hire("Dee", "Design", 1000);
    const sam = hire("Sam", "Sales", 1000);
    const edit = (department: string, budgetCents: number) => organization.updateAgent({
      orgId, agentId: sam, role: "Staff", title: "Staff", roleLevel: "staff", department, budgetCents, modelProviderId: null, modelId: null,
    });

    expect(() => edit("Design", 1000)).toThrow("Design is at its headcount limit (1).");
    expect(() => edit("Sales", 3500)).toThrow("Sales would budget $35.00 a month, over its $30.00 limit.");
    edit("Sales", 3000);
    // A department already over its limit still allows edits that do not add to it.
    connection.db.prepare("update hiring_policies set monthly_budget_limit_cents = 100 where org_id = ? and department_name = 'Sales'").run(orgId);
    edit("Sales", 2000);
    expect(connection.db.prepare("select department, budget_cents from agents where id = ?").get(sam)).toEqual({ department: "Sales", budget_cents: 2000 });
    // A hire awaiting approval already holds its place in the department.
    connection.db.prepare("update agents set department = 'Sales' where name = 'Dee'").run();
    connection.db.prepare("insert into agents(id, org_id, name, role, department, budget_cents, lifecycle, created_at) values ('agt_pending', ?, 'Pat', 'Staff', 'Design', 1000, 'pending_hire', ?)").run(orgId, new Date().toISOString());
    expect(() => edit("Design", 1000)).toThrow("Design is at its headcount limit (1).");
    connection.close();
  });

  test("the CEO's rank is one per company and no edit grants or removes it", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-rank-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    });
    const hire = (name: string, roleLevel: string) => organization.createAgent({
      orgId, name, role: name, department: "Executive", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null, roleLevel,
    });
    const ceo = hire("Chief", "c_suite");
    expect(() => hire("Rival", "c_suite")).toThrow("The company already has its CEO; officers are directors with a title.");
    const cto = hire("Cora", "director");
    const edit = (agentId: string, roleLevel: string) => organization.updateAgent({
      orgId, agentId, role: "Exec", title: "Exec", roleLevel, department: "Executive", budgetCents: 1000, modelProviderId: null, modelId: null,
    });
    expect(() => edit(cto, "c_suite")).toThrow("The CEO's rank carries company-wide powers and cannot be given by an edit; officers are directors with a title.");
    expect(() => edit(ceo, "director")).toThrow("The CEO's rank carries company-wide powers (hiring officers, granting connectors and skills, closing goals) and cannot be changed by an edit.");
    edit(ceo, "c_suite");
    edit(cto, "lead");
    expect(connection.db.prepare("select name, role_level from agents where org_id = ? order by name").all(orgId)).toEqual([
      { name: "Chief", role_level: "c_suite" }, { name: "Cora", role_level: "lead" },
    ]);
    connection.close();
  });
});
