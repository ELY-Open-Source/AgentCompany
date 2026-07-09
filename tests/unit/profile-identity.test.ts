import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";

function harness(): { connection: DatabaseConnection; organization: OrganizationService; orgId: string; agentId: string; employeeId: string } {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-profile-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let agentId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
    agentId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: null, modelId: null, budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
    });
  });
  const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
  return { connection, organization, orgId, agentId, employeeId };
}

describe("identity editing", () => {
  test("renames an agent (the CEO included) and stores its avatar", () => {
    const h = harness();
    h.connection.transaction(() => h.organization.updateAgent({
      orgId: h.orgId,
      agentId: h.agentId,
      name: "Nova Chen",
      role: "CEO",
      title: "Chief Executive Officer",
      roleLevel: "c_suite",
      department: "Executive",
      budgetCents: 25000,
      modelProviderId: null,
      modelId: null,
      avatarEmoji: "🚀",
      avatarColor: "#26B69A",
    }));
    const row = h.connection.db.prepare("select name, avatar_emoji, avatar_color from agents where id = ?").get(h.agentId) as
      { name: string; avatar_emoji: string; avatar_color: string };
    expect(row).toEqual({ name: "Nova Chen", avatar_emoji: "🚀", avatar_color: "#26b69a" });

    // Clearing the avatar returns the tile to the hashed palette.
    h.connection.transaction(() => h.organization.updateAgent({
      orgId: h.orgId,
      agentId: h.agentId,
      role: "CEO",
      title: "Chief Executive Officer",
      roleLevel: "c_suite",
      department: "Executive",
      budgetCents: 25000,
      modelProviderId: null,
      modelId: null,
      avatarEmoji: "",
      avatarColor: "",
    }));
    const cleared = h.connection.db.prepare("select name, avatar_emoji, avatar_color from agents where id = ?").get(h.agentId) as
      { name: string; avatar_emoji: string | null; avatar_color: string | null };
    expect(cleared).toEqual({ name: "Nova Chen", avatar_emoji: null, avatar_color: null });
    h.connection.close();
  });

  test("rejects blank names and malformed avatar colors", () => {
    const h = harness();
    const base = {
      orgId: h.orgId,
      agentId: h.agentId,
      role: "CEO",
      title: "Chief Executive Officer",
      roleLevel: "c_suite",
      department: "Executive",
      budgetCents: 25000,
      modelProviderId: null,
      modelId: null,
    };
    expect(() => h.organization.updateAgent({ ...base, name: "   " })).toThrow("Agent name is required.");
    expect(() => h.organization.updateAgent({ ...base, avatarColor: "red" })).toThrow("Avatar color must be a #rrggbb hex value.");
    h.connection.close();
  });

  test("updates the operator's display name and avatar", () => {
    const h = harness();
    h.connection.transaction(() => h.organization.updateEmployeeProfile({
      orgId: h.orgId,
      employeeId: h.employeeId,
      displayName: "Yang Zhang",
      avatarEmoji: "🎯",
      avatarColor: "#5e6ad2",
    }));
    const row = h.connection.db.prepare("select display_name, avatar_emoji, avatar_color from employees where id = ?").get(h.employeeId) as
      { display_name: string; avatar_emoji: string; avatar_color: string };
    expect(row).toEqual({ display_name: "Yang Zhang", avatar_emoji: "🎯", avatar_color: "#5e6ad2" });
    expect(() => h.organization.updateEmployeeProfile({ orgId: h.orgId, employeeId: h.employeeId, displayName: " " }))
      .toThrow("Display name is required.");
    h.connection.close();
  });
});
