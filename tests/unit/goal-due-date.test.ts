import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";

describe("a goal's target date", () => {
  test("is set at creation or later, cleared with null, and refused when it is not a date", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-goal-due-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let goalId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
      goalId = organization.createGoal({ orgId, title: "Launch", description: "d", ownerAgentId: null, dueAt: "2026-12-31T23:59:59.000Z" });
    });
    const dueAt = () => (connection.db.prepare("select due_at from goals where id = ?").get(goalId) as { due_at: string | null }).due_at;
    expect(dueAt()).toBe("2026-12-31T23:59:59.000Z");
    organization.setGoalDueDate({ orgId, goalId, dueAt: null });
    expect(dueAt()).toBeNull();
    expect(() => organization.setGoalDueDate({ orgId, goalId, dueAt: "soon" })).toThrow('"soon" is not a date.');
    expect(() => organization.setGoalDueDate({ orgId, goalId, dueAt: "2026-02-30T23:59:59.000Z" })).toThrow('"2026-02-30T23:59:59.000Z" is not a date.');
    organization.setGoalDueDate({ orgId, goalId, dueAt: "2026-02-28T23:59:59Z" });
    expect(dueAt()).toBe("2026-02-28T23:59:59.000Z");
    expect(() => organization.setGoalDueDate({ orgId, goalId: "gol_missing", dueAt: null })).toThrow("Goal was not found.");
    connection.close();
  });
});
