import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { FileService } from "../../src/main/services/file-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { SkillService } from "../../src/main/services/skill-service";
import { ChatService } from "../../src/main/services/chat-service";
import { MigrationService } from "../../src/main/services/migration-service";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { SocialService } from "../../src/main/services/social-service";
import { RISK_LEVEL, SOCIAL_PLATFORM, TASK_STATUS } from "../../src/shared/domain";
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
    expect(state.policyRules[0]?.action).toBe("task_create");
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
        projectId: null,
        goalId: null,
        workspaceId: null,
        priority: "normal",
        requiresFilesystem: false,
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
    const skills = new SkillService(connection.db, join(tmpdir(), `agentcompany-skill-artifacts-${randomUUID()}`));
    const snapshot = new SnapshotService(connection.db);
    const skillDir = join(tmpdir(), `agentcompany-skill-${randomUUID()}`);
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(join(skillDir, "tests"), { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Review Routes\n");
    writeFileSync(join(skillDir, "tests", "happy_path.yaml"), "input: review\n");
    writeFileSync(join(skillDir, "skill.manifest.json"), JSON.stringify({
      name: "review-routes",
      version: "1.0.0",
      entrypoint: "SKILL.md",
      capabilities: ["architecture-review"],
      required_tools: ["file_search"],
      compatible_models: ["openai/*", "anthropic/*"],
      risk_level: "medium",
      inputs: { diff: "markdown" },
      outputs: { recommendation: "markdown" },
      tests: ["tests/happy_path.yaml"],
    }));
    let orgId = "";
    let agentId = "";
    let revisionId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      agentId = organization.createAgent({
        orgId,
        name: "Ada",
        role: "Architecture reviewer",
        department: "Engineering",
        modelProviderId: null,
        modelId: null,
        budgetCents: 10000,
        managerAgentId: null,
      });
      revisionId = skills.importDirectory({ orgId, directoryPath: skillDir, versionSemver: "1.0.0" });
      const skill = connection.db.prepare("select id from skill_definitions where org_id = ? and slug = ?")
        .get(orgId, "review-routes") as { id: string };
      skills.bind({ orgId, agentId, skillId: skill.id, revisionId });
      rmSync(skillDir, { recursive: true, force: true });
      skills.resolveRuntimeSnapshot({ orgId, agentId, runId: "run-review-1" });
    });

    const state = snapshot.load();
    expect(state.skillDefinitions[0]?.slug).toBe("review-routes");
    expect(state.skillRevisions[0]?.versionSemver).toBe("1.0.0");
    expect(state.skillRevisions[0]?.immutableChecksum).toHaveLength(64);
    expect(state.skillRevisions[0]?.manifestJson).toContain("architecture-review");
    expect(state.skillRuntimeSnapshots[0]?.sourceRevisionIds).toContain(revisionId);
    expect(state.skillRuntimeSnapshots[0]?.compiledPrompt).toContain("# Review Routes");
    connection.close();
  });

  test("rejects cross-organization skill binding and duplicate runtime snapshots", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const skills = new SkillService(connection.db, join(tmpdir(), `agentcompany-skill-artifacts-${randomUUID()}`));
    const skillDir = join(tmpdir(), `agentcompany-skill-${randomUUID()}`);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Review Routes\n");
    writeFileSync(join(skillDir, "skill.manifest.json"), JSON.stringify({
      name: "review-routes",
      version: "1.0.0",
      entrypoint: "SKILL.md",
      capabilities: [],
      required_tools: [],
      compatible_models: ["openai/*"],
      risk_level: "low",
      inputs: {},
      outputs: {},
      tests: [],
    }));
    let orgA = "";
    let orgB = "";
    let agentA = "";
    let agentB = "";
    let skillId = "";
    let revisionId = "";

    connection.transaction(() => {
      orgA = organization.createOrganization({ organizationName: "Acme A", employeeName: "Dana Lee", mission: "A", goal: "A" });
      orgB = organization.createOrganization({ organizationName: "Acme B", employeeName: "Riley Chen", mission: "B", goal: "B" });
      agentA = organization.createAgent({ orgId: orgA, name: "Ada", role: "Reviewer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 10000, managerAgentId: null });
      agentB = organization.createAgent({ orgId: orgB, name: "Ben", role: "Reviewer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 10000, managerAgentId: null });
      revisionId = skills.importDirectory({ orgId: orgA, directoryPath: skillDir, versionSemver: "1.0.0" });
      skillId = (connection.db.prepare("select id from skill_definitions where org_id = ? and slug = ?")
        .get(orgA, "review-routes") as { id: string }).id;
      expect(() => skills.bind({ orgId: orgA, agentId: agentB, skillId, revisionId })).toThrow("Agent was not found.");
      skills.bind({ orgId: orgA, agentId: agentA, skillId, revisionId });
      skills.resolveRuntimeSnapshot({ orgId: orgA, agentId: agentA, runId: "run-review-1" });
      expect(() => skills.resolveRuntimeSnapshot({ orgId: orgA, agentId: agentA, runId: "run-review-1" }))
        .toThrow("Skill runtime snapshot already exists for this run.");
    });

    expect(agentA).not.toBe(agentB);
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
      const spaceId = chat.createSpace({
        orgId,
        spaceType: "project",
        name: "release",
        topic: "Release coordination",
        visibility: "workspace",
      });
      const employee = connection.db.prepare("select id from employees where org_id = ?")
        .get(orgId) as { id: string };
      const fileId = createId("file");
      connection.db.prepare(`
        insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, owner_type, owner_id, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, orgId, "runbook.md", "text/markdown", 16, "8f3a", "artifacts/runbook.md", "employee", employee.id, new Date().toISOString());

      chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employee.id,
        bodyMd: "/handoff @Board review the deployment runbook",
        attachmentFileIds: [fileId],
      });
    });

    const state = snapshot.load();
    expect(state.chatSpaces.map((space) => space.name)).toContain("release");
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

  test("creates a read-only migration report from a legacy database", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const migrations = new MigrationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const legacyPath = join(tmpdir(), `agentcompany-legacy-${randomUUID()}.db`);
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec("create table agents(id text primary key); insert into agents(id) values ('agent-1');");
    legacy.close();
    let orgId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      migrations.createReport({ orgId, sourceDatabasePath: legacyPath });
    });

    const state = snapshot.load();
    expect(state.migrationReports).toHaveLength(1);
    expect(state.migrationReports[0]?.reportJson).toContain("\"agents\":1");
    const report = JSON.parse(state.migrationReports[0]!.reportJson) as {
      tableChecksums: Record<string, string>;
      idMaps: Record<string, string[]>;
      failures: Array<{ table: string; reason: string }>;
      rollbackPack: { sourceDatabasePath: string };
    };
    expect(report.tableChecksums.agents).toHaveLength(64);
    expect(report.idMaps.agents).toEqual(["agent-1"]);
    expect(report.failures.some((failure) => failure.reason === "missing_table")).toBe(true);
    expect(report.rollbackPack.sourceDatabasePath).toBe(legacyPath);
    connection.close();
  });

  test("creates social accounts with employee grants", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const social = new SocialService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?")
        .get(orgId) as { id: string }).id;
      social.createAccount({
        orgId,
        platform: SOCIAL_PLATFORM.X,
        handle: "@acme",
        displayName: "Acme",
        authorizedEmployeeId: employeeId,
      });
    });

    const state = snapshot.load();
    expect(state.socialAccounts).toHaveLength(1);
    expect(state.socialAccountGrants[0]?.employeeId).toBe(employeeId);
    connection.close();
  });

  test("pins files and schedules social posts", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const social = new SocialService(connection.db);
    const files = new FileService(connection.db, join(tmpdir(), `artifacts-${randomUUID()}`));
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let socialAccountId = "";
    let fileId = "";
    let employeeId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      socialAccountId = social.createAccount({
        orgId,
        platform: SOCIAL_PLATFORM.X,
        handle: "@acme",
        displayName: "Acme",
        authorizedEmployeeId: employeeId,
      });
      fileId = createId("fil");
      connection.db.prepare(`
        insert into file_objects(
          id, org_id, name, kind, size_bytes, sha256, storage_path,
          owner_type, owner_id, space_id, pinned, created_at, updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, orgId, "launch-thread.md", "md", 256, "abc", "artifacts/launch-thread.md", "employee", employeeId, null, 0, new Date().toISOString(), new Date().toISOString());
      files.setPinned(orgId, fileId, true);
      social.createScheduledPost({
        orgId,
        socialAccountId,
        bodyMd: "Pilot starts Friday.",
        scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        state: "scheduled",
        createdByEmployeeId: employeeId,
      });
    });

    const state = snapshot.load();
    expect(state.files[0]?.pinned).toBe(true);
    expect(state.scheduledPosts).toHaveLength(1);
    expect(state.scheduledPosts[0]?.state).toBe("scheduled");
    expect(state.scheduledPosts[0]?.socialAccountId).toBe(socialAccountId);
    connection.close();
  });

  test("bootstraps the original onboarding chain with company, CEO, goal, project, task, and run", () => {
    const connection = createConnection();
    const onboarding = new OnboardingService({
      db: connection.db,
      saveProviderCredential: ({ orgId, providerId, model }) => {
        connection.db.prepare("update providers set credential_id = ?, model = ?, enabled = 1 where id = ? and org_id = ?")
          .run("cred_test", model, providerId, orgId);
      },
    });
    const snapshot = new SnapshotService(connection.db);

    connection.transaction(() => onboarding.bootstrap({
      companyName: "Acme Operations",
      companyDescription: "Coordinate agents with auditable approvals.",
      employeeName: "Dana Lee",
      workspacePath: join(tmpdir(), `agentcompany-workspace-${randomUUID()}`),
      executionMode: "ai_ceo",
      autoApproveHires: true,
      reviewDeliverables: false,
      goalTitle: "Ship a verified control plane",
      goalDescription: "Bring the desktop operating loop online.",
      providerKey: "openai",
      providerSecret: "test-secret",
      providerModel: "gpt-5.1",
    }));

    const state = snapshot.load();
    expect(state.organizations[0]?.executionMode).toBe("ai_ceo");
    expect(state.agents[0]?.roleLevel).toBe("c_suite");
    expect(state.agents[0]?.modelStrategy).toBe("explicit");
    expect(state.workspaces).toHaveLength(1);
    expect(state.goals[0]?.status).toBe("active");
    expect(state.projects[0]?.leadAgentId).toBe(state.agents[0]?.id);
    expect(state.tasks[0]?.assigneeAgentId).toBe(state.agents[0]?.id);
    expect(state.taskRuns[0]?.trigger).toBe("bootstrap");
    connection.close();
  });
});
