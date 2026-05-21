import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { SkillService } from "../../src/main/services/skill-service";
import { ChatService } from "../../src/main/services/chat-service";
import { RISK_LEVEL, TASK_STATUS } from "../../src/shared/domain";
import { createId } from "../../src/shared/ids";

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

  test("records collaborative chat semantics for threads, commands, mentions, and files", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      const space = connection.db.prepare("select id from chat_spaces where org_id = ? and name = ?")
        .get(orgId, "engineering") as { id: string };
      const employee = connection.db.prepare("select id from employees where org_id = ?")
        .get(orgId) as { id: string };
      const fileId = createId("file");
      connection.db.prepare(`
        insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, owner_type, owner_id, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, orgId, "runbook.md", "text/markdown", 16, "8f3a", "artifacts/runbook.md", "employee", employee.id, new Date().toISOString());

      chat.sendMessage({
        orgId,
        spaceId: space.id,
        threadId: null,
        senderType: "employee",
        senderId: employee.id,
        bodyMd: "/handoff @Board review the deployment runbook",
        attachmentFileIds: [fileId],
      });
    });

    const state = snapshot.load();
    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatThreads).toHaveLength(1);
    expect(state.chatAttachments).toHaveLength(1);
    expect(state.chatPresence).toHaveLength(1);
    const slash = connection.db.prepare("select command from chat_slash_invocations").get() as { command: string };
    const mention = connection.db.prepare("select target_id from chat_mentions").get() as { target_id: string };
    expect(slash.command).toBe("handoff");
    expect(mention.target_id).toBe("Board");
    connection.close();
  });
});
