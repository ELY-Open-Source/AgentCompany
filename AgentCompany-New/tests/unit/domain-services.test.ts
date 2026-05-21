import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { SkillService } from "../../src/main/services/skill-service";
import { RISK_LEVEL, TASK_STATUS } from "../../src/shared/domain";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-${randomUUID()}.db`));
}

describe("domain services", () => {
  test("creates an organization with providers, chat spaces, employee, and audit", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);

    connection.transaction(() => organization.createOrganization({
      organizationName: "Acme Operations",
      employeeName: "Dana Lee",
      mission: "Coordinate agents with auditable approvals.",
      goal: "Ship a verified control plane.",
    }));

    const state = snapshot.load();
    expect(state.organizations).toHaveLength(1);
    expect(state.employees[0]?.displayName).toBe("Dana Lee");
    expect(state.providers.length).toBeGreaterThanOrEqual(6);
    expect(state.chatSpaces.map((space) => space.name)).toContain("board");
    expect(state.auditEvents[0]?.action).toBe("created");
    connection.close();
  });

  test("high risk work creates a pending approval", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      organization.createTask({
        orgId,
        title: "Production deploy",
        description: "Deploy a high-risk change.",
        status: TASK_STATUS.BACKLOG,
        assigneeAgentId: null,
        risk: RISK_LEVEL.HIGH,
      });
    });

    const state = snapshot.load();
    expect(state.tasks).toHaveLength(1);
    expect(state.approvals).toHaveLength(1);
    expect(state.approvals[0]?.state).toBe("pending");
    connection.close();
  });

  test("imports a versioned skill revision from a local directory", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const skills = new SkillService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const skillDir = join(tmpdir(), `agentcompany-skill-${randomUUID()}`);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: review-routes\n---\n# Review Routes\n");
    let orgId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      skills.importDirectory({ orgId, directoryPath: skillDir, versionSemver: "1.0.0" });
    });

    const state = snapshot.load();
    expect(state.skillDefinitions[0]?.slug).toBe("review-routes");
    expect(state.skillRevisions[0]?.versionSemver).toBe("1.0.0");
    expect(state.skillRevisions[0]?.immutableChecksum).toHaveLength(64);
    connection.close();
  });
});
