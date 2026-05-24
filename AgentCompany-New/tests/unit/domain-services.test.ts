import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { SkillService } from "../../src/main/services/skill-service";
import { ChatService } from "../../src/main/services/chat-service";
import { MigrationService } from "../../src/main/services/migration-service";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { RISK_LEVEL, TASK_STATUS } from "../../src/shared/domain";
import { createId } from "../../src/shared/ids";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-${randomUUID()}.db`));
}

describe("domain services", () => {
  test("records every applied schema migration version", () => {
    const connection = createConnection();

    const rows = connection.db.prepare("select version from schema_migrations order by version asc").all() as Array<{ version: number }>;
    expect(rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
    connection.close();
  });

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
    expect(state.employeeIdentities).toHaveLength(1);
    expect(state.roleGrants.map((grant) => grant.roleKey).sort()).toEqual(["approval_decider", "hiring_manager", "org_admin"]);
    expect(state.orgDepartments.map((department) => department.name)).toContain("Engineering");
    expect(state.hiringPolicies.some((policy) => policy.departmentName === "Engineering")).toBe(true);
    expect(state.approvalRoutingRules[0]).toMatchObject({ kind: "*", minimumRisk: "low", routeToType: "employee" });
    expect(state.featureFlags.map((flag) => flag.key)).toContain("chaos_drills");
    expect(state.sloTargets.map((target) => target.signalKey)).toContain("provider_request_success");
    expect(state.chaosDrills.map((drill) => drill.scenarioKey)).toContain("approval_backlog_gate");
    expect(state.sdlcReviewAgents.map((agent) => agent.key)).toContain("code_reviewer");
    expect(state.evalSuites.map((suite) => suite.key)).toContain("contract");
    expect(state.prBotGates.map((gate) => gate.key)).toContain("static_checks");
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
    expect(state.approvalAssignments).toHaveLength(1);
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
    expect(state.files[0]?.scanState).toBe("approved");
    expect(state.fileAccessGrants[0]).toMatchObject({ grantedToType: "board", grantedToId: orgId, accessLevel: "read" });
    expect(state.chatMentions[0]).toMatchObject({ targetType: "board", targetId: orgId });
    expect(state.chatSlashInvocations[0]).toMatchObject({ command: "handoff" });
    expect(state.chatPresence).toHaveLength(1);
    const slash = connection.db.prepare("select command from chat_slash_invocations").get() as { command: string };
    const mention = connection.db.prepare("select target_type, target_id from chat_mentions").get() as { target_type: string; target_id: string };
    expect(slash.command).toBe("handoff");
    expect(mention.target_type).toBe("board");
    expect(mention.target_id).toBe(orgId);
    connection.close();
  });

  test("enforces scanned file grants for agent handoff", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let spaceId = "";
    let adaId = "";
    let benId = "";
    let approvedFileId = "";
    let blockedFileId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      adaId = organization.createAgent({
        orgId,
        name: "Ada",
        role: "Release reviewer",
        department: "Engineering",
        modelProviderId: null,
        modelId: null,
        budgetCents: 10000,
        managerAgentId: null,
      });
      benId = organization.createAgent({
        orgId,
        name: "Ben",
        role: "Runtime owner",
        department: "Engineering",
        modelProviderId: null,
        modelId: null,
        budgetCents: 10000,
        managerAgentId: null,
      });
      spaceId = chat.createSpace({ orgId, spaceType: "project", name: "release", topic: "Release coordination", visibility: "workspace" });
      approvedFileId = createId("fil");
      blockedFileId = createId("fil");
      const now = new Date().toISOString();
      connection.db.prepare(`
        insert into file_objects(
          id, org_id, name, kind, size_bytes, sha256, storage_path,
          owner_type, owner_id, space_id, pinned, scan_state, scan_labels_json, scanned_at, created_at, updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(approvedFileId, orgId, "release-notes.md", "md", 24, "sha-approved", "artifacts/release-notes.md", "agent", adaId, null, 0, "approved", "[]", now, now, now);
      connection.db.prepare(`
        insert into file_objects(
          id, org_id, name, kind, size_bytes, sha256, storage_path,
          owner_type, owner_id, space_id, pinned, scan_state, scan_labels_json, scanned_at, created_at, updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(blockedFileId, orgId, "quarantine.bin", "file", 8, "sha-blocked", "artifacts/quarantine.bin", "agent", adaId, null, 0, "blocked", "[\"signature\"]", now, now, now);
    });

    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId,
      threadId: null,
      senderType: "agent",
      senderId: benId,
      bodyMd: "Attach release notes",
      attachmentFileIds: [approvedFileId],
    }))).toThrow("Attachment file access is required.");

    connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId,
      threadId: null,
      senderType: "agent",
      senderId: adaId,
      bodyMd: "/handoff @Ben release notes",
      attachmentFileIds: [approvedFileId],
    }));

    expect(() => connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId,
      threadId: null,
      senderType: "agent",
      senderId: adaId,
      bodyMd: "/handoff @Ben blocked payload",
      attachmentFileIds: [blockedFileId],
    }))).toThrow("Attachment file is not approved for handoff.");

    connection.transaction(() => chat.sendMessage({
      orgId,
      spaceId,
      threadId: null,
      senderType: "agent",
      senderId: benId,
      bodyMd: "Received release notes",
      attachmentFileIds: [approvedFileId],
    }));

    const state = snapshot.load();
    const benGrant = state.fileAccessGrants.find((grant) => grant.fileId === approvedFileId && grant.grantedToId === benId);
    if (!benGrant) throw new Error("Agent handoff grant was not created.");
    expect(benGrant).toMatchObject({ grantedToType: "agent", accessLevel: "read" });
    expect(state.chatMessages).toHaveLength(2);
    expect(state.auditEvents.some((event) => event.entityType === "file_object" && event.action === "access_granted")).toBe(true);
    connection.close();
  });

  test("creates approval and waiting presence from chat escalation", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";
    let spaceId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      spaceId = chat.createSpace({
        orgId,
        spaceType: "project",
        name: "release",
        topic: "Release coordination",
        visibility: "workspace",
      });
      chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "/escalate @Board freeze deployment",
        attachmentFileIds: [],
      });
    });

    const state = snapshot.load();
    const approval = state.approvals.find((item) => item.kind === "chat_escalation");
    if (!approval) throw new Error("Chat escalation approval was not created.");
    expect(approval.title).toBe("Escalate release");
    expect(approval.details).toBe("@Board freeze deployment");
    expect(approval.risk).toBe("high");
    expect(state.chatSlashInvocations[0]?.resultRef).toBe(approval.id);
    expect(state.chatPresence[0]).toMatchObject({ principalId: employeeId, status: "waiting_approval" });
    const audit = state.auditEvents.find((event) => event.entityId === approval.id && event.action === "requested");
    if (!audit) throw new Error("Chat escalation audit event was not created.");
    expect(audit.payloadJson).toContain(state.chatMessages[0]!.id);
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
