import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ApprovalService } from "../../src/main/services/approval-service";
import { ChatService } from "../../src/main/services/chat-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SdlcService } from "../../src/main/services/sdlc-service";
import { SkillService } from "../../src/main/services/skill-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { APPROVAL_STATE, EVAL_SUITE_KEY, SDLC_RUN_STATE } from "../../src/shared/domain";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-integration-${randomUUID()}.db`));
}

function createOrganization(organization: OrganizationService): string {
  return organization.createOrganization({
    organizationName: "Acme Operations",
    employeeName: "Dana Lee",
    mission: "Coordinate agents with auditable approvals.",
    goal: "Ship a verified control plane.",
  });
}

function createSkillDirectory(): string {
  const root = join(tmpdir(), `agentcompany-new-skill-${randomUUID()}`);
  mkdirSync(join(root, "checks"), { recursive: true });
  writeFileSync(join(root, "SKILL.md"), "Review release evidence and produce a concise gate decision.\n", "utf8");
  writeFileSync(join(root, "checks", "acceptance.txt"), "release evidence accepted\n", "utf8");
  writeFileSync(join(root, "skill.manifest.json"), JSON.stringify({
    name: "Release Gate",
    version: "1.0.0",
    entrypoint: "SKILL.md",
    capabilities: ["release-review"],
    required_tools: ["git"],
    compatible_models: ["gpt-5.4"],
    risk_level: "low",
    tests: ["checks/acceptance.txt"],
    inputs: {},
    outputs: {},
  }, null, 2), "utf8");
  return root;
}

describe("collaboration integration flow", () => {
  test("connects chat escalation, approval routing, skill resolution, and integration eval", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const approvals = new ApprovalService(connection.db);
    const chat = new ChatService(connection.db);
    const skills = new SkillService(connection.db, join(tmpdir(), `agentcompany-new-artifacts-${randomUUID()}`));
    const sdlc = new SdlcService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";
    let agentId = "";
    let approvalId = "";
    let skillId = "";
    let revisionId = "";
    let suiteId = "";
    let evalRunId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      agentId = organization.createAgent({
        orgId,
        name: "Ada",
        role: "Release reviewer",
        department: "Engineering",
        modelProviderId: null,
        modelId: null,
        budgetCents: 10000,
        managerAgentId: null,
      });
      const spaceId = chat.createSpace({
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
        bodyMd: "/escalate review release acceptance package",
        attachmentFileIds: [],
      });
      approvalId = (connection.db.prepare("select id from approvals where org_id = ? and kind = ?")
        .get(orgId, "chat_escalation") as { id: string }).id;
      approvals.decide({ orgId, approvalId, state: APPROVAL_STATE.APPROVED, decidedByEmployeeId: employeeId });
      revisionId = skills.importDirectory({ orgId, directoryPath: createSkillDirectory(), versionSemver: "1.0.0" });
      skillId = (connection.db.prepare("select skill_id from skill_revisions where id = ?").get(revisionId) as { skill_id: string }).skill_id;
      skills.bind({ orgId, agentId, skillId, revisionId });
      skills.resolveRuntimeSnapshot({ orgId, agentId, runId: `run_${randomUUID().replaceAll("-", "")}` });
      suiteId = (connection.db.prepare("select id from eval_suites where org_id = ? and key = ?")
        .get(orgId, EVAL_SUITE_KEY.INTEGRATION) as { id: string }).id;
      evalRunId = sdlc.runEvalSuite({ orgId, suiteId });
    });

    const state = snapshot.load();
    const evalRun = state.evalRuns.find((run) => run.id === evalRunId);
    const snapshotRecord = state.skillRuntimeSnapshots[0];
    if (!evalRun) throw new Error("Integration eval run was not created.");
    if (!snapshotRecord) throw new Error("Skill runtime snapshot was not created.");
    expect(state.approvals.find((approval) => approval.id === approvalId)?.state).toBe(APPROVAL_STATE.APPROVED);
    expect(state.approvalAssignments.some((assignment) => assignment.approvalId === approvalId)).toBe(true);
    expect(snapshotRecord.compiledPrompt).toContain("Release Gate");
    expect(evalRun).toMatchObject({ state: SDLC_RUN_STATE.PASSED, failedCount: 0 });
    expect(state.operationalEvents.some((event) => event.signalKey === "skill_resolve_success")).toBe(true);
    connection.close();
  });
});
