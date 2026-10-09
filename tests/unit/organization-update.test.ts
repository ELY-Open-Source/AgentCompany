import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";

describe("company settings after onboarding", () => {
  test("the profile and how the company runs can be changed later, and each change is audited", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-org-update-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
    });
    const update = (change: Partial<{ name: string; executionMode: "ai_ceo" | "ai_cofounder" }>) => connection.transaction(() => organization.updateOrganization({
      orgId, name: "Acme Labs", description: "Analytics for CSMs.", mission: "Keep customers.", goal: "Ship the MVP.",
      executionMode: "ai_cofounder", autoApproveHires: false, reviewDeliverables: true, ...change,
    }));
    update({});
    expect(connection.db.prepare("select name, description, mission, goal, execution_mode, auto_approve_hires, review_deliverables from organizations where id = ?").get(orgId))
      .toEqual({ name: "Acme Labs", description: "Analytics for CSMs.", mission: "Keep customers.", goal: "Ship the MVP.", execution_mode: "ai_cofounder", auto_approve_hires: 0, review_deliverables: 1 });
    const audit = connection.db.prepare("select payload_json from audit_events where entity_type = 'organization' and action = 'updated' order by rowid desc limit 1").get() as { payload_json: string };
    expect(JSON.parse(audit.payload_json).changed).toEqual(expect.arrayContaining(["name", "executionMode", "reviewDeliverables"]));
    expect(() => update({ name: "  " })).toThrow("The company needs a name.");
    expect(() => organization.updateOrganization({ orgId: "org_missing", name: "X", description: "", mission: "", goal: "", executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false }))
      .toThrow("Organization was not found.");
    connection.close();
  });
});
