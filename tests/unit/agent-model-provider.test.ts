import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";

describe("an agent's model belongs to its provider", () => {
  test("a model without a provider is refused on hire and on edit", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-agent-model-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let agentId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
    });
    const hire = (modelId: string | null) => organization.createAgent({
      orgId, name: `Ada ${randomUUID().slice(0, 4)}`, role: "Engineer", department: "Engineering", modelProviderId: null, modelId, budgetCents: 1000, managerAgentId: null,
    });
    expect(() => connection.transaction(() => hire("gpt-5.4"))).toThrow("Pick the provider before its model.");
    connection.transaction(() => { agentId = hire(null); });
    expect(() => connection.transaction(() => organization.updateAgent({
      orgId, agentId, name: "Ada", role: "Engineer", title: "Engineer", roleLevel: "staff", department: "Engineering", budgetCents: 1000, modelProviderId: null, modelId: "gpt-5.4",
    }))).toThrow("Pick the provider before its model.");
  });
});
