import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { SkillService } from "../../src/main/services/skill-service";
import { AGENT_TOOLS, dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";
import { writingModeLines } from "../../src/main/services/task-prompts";

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

interface Harness {
  connection: DatabaseConnection;
  orgId: string;
  ceoId: string;
  danaId: string;
  ceoCtx: AgentToolContext;
  danaCtx: AgentToolContext;
  deps: { db: DatabaseConnection["db"]; organization: OrganizationService; chat: ChatService };
}

function harness(): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-skill-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let ceoId = "";
  let danaId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    ceoId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
    });
    danaId = organization.createAgent({
      orgId, name: "Dana", role: "Engineer", department: "Engineering",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: ceoId,
    });
  });
  const context = (agentId: string): AgentToolContext => ({
    orgId,
    agent: { id: agentId, modelProviderId: null, modelId: null },
    taskProjectId: null,
    taskGoalId: null, taskId: null, sourceThreadId: null,
    workspace: null,
  });
  return {
    connection,
    orgId,
    ceoId,
    danaId,
    ceoCtx: context(ceoId),
    danaCtx: context(danaId),
    deps: { db: connection.db, organization, chat: new ChatService(connection.db) },
  };
}

function importSkill(h: Harness, name: string, slug: string): void {
  const now = new Date().toISOString();
  h.connection.db.prepare(`
    insert into skill_definitions(id, org_id, slug, name, owner_type, status, created_at)
    values (?, ?, ?, ?, 'organization', 'active', ?)
  `).run(`skl_${slug}`, h.orgId, slug, name, now);
  h.connection.db.prepare(`
    insert into skill_revisions(id, skill_id, version_semver, manifest_json, source_type, source_ref, published_at, immutable_checksum)
    values (?, ?, '1.0.0', '{}', 'local_directory', '/tmp', ?, 'checksum')
  `).run(`skr_${slug}`, `skl_${slug}`, now);
  h.connection.db.prepare(`
    insert into skill_artifacts(id, revision_id, artifact_type, object_key, sha256, size_bytes)
    values (?, ?, 'entrypoint', ?, 'sha', 1)
  `).run(`ska_${slug}`, `skr_${slug}`, `/tmp/${slug}/SKILL.md`);
}

describe("skill grants", () => {
  test("create_task records the writing mode, which decides house style and the writing rule", () => {
    const h = harness();
    const created = dispatchAgentTool(h.deps, h.ceoCtx, call("create_task", { title: "API spec", description: "Write the spec.", writing_mode: "technical" }));
    const taskId = /task_id=(tsk_\w+)/.exec(created)![1];
    expect(h.connection.db.prepare("select writing_mode from tasks where id = ?").get(taskId)).toEqual({ writing_mode: "technical" });
    const plain = dispatchAgentTool(h.deps, h.ceoCtx, call("create_task", { title: "Chat", description: "Say hi." }));
    expect(h.connection.db.prepare("select writing_mode from tasks where id = ?").get(/task_id=(tsk_\w+)/.exec(plain)![1])).toEqual({ writing_mode: "conversational" });
    expect(dispatchAgentTool(h.deps, h.ceoCtx, call("create_task", { title: "X", description: "Y", writing_mode: "poetic" })))
      .toBe('ERROR: "writing_mode" must be one of: conversational, technical, structured.');
    expect(writingModeLines("conversational")).toEqual([]);
    expect(writingModeLines("technical").join(" ")).toContain("Technical writing");
    expect(writingModeLines("structured").join(" ")).toContain("Structured output");
    h.connection.close();
  });

  test("the CEO runs only with granted skills, as the tool text says, and can grant itself", () => {
    const h = harness();
    importSkill(h, "Release Gate", "release-gate");
    const listSkills = AGENT_TOOLS.find((tool) => tool.name === "list_skills");
    expect(listSkills?.description).not.toContain("every skill automatically");
    expect(listSkills?.description).toContain("the CEO included");
    const skills = new SkillService(h.connection.db, "");
    expect(skills.hasRuntimeSkills(h.orgId, h.ceoId, true, "en")).toBe(false);
    expect(dispatchAgentTool(h.deps, h.ceoCtx, call("grant_skill", { agent_name: "CEO", skill: "release-gate" })))
      .toBe("CEO now has the Release Gate skill; it joins their next run.");
    expect(skills.hasRuntimeSkills(h.orgId, h.ceoId, true, "en")).toBe(true);
    h.connection.close();
  });

  test("the CEO grants and revokes skills for teammates", () => {
    const h = harness();
    importSkill(h, "Release Gate", "release-gate");

    const granted = dispatchAgentTool(h.deps, h.ceoCtx, call("grant_skill", { agent_name: "Dana", skill: "release-gate" }));
    expect(granted).toContain("Dana now has the Release Gate skill");

    const listing = dispatchAgentTool(h.deps, h.danaCtx, call("list_skills", {}));
    expect(listing).toContain("Release Gate (release-gate): granted to Dana");

    const skills = new SkillService(h.connection.db, "");
    expect(skills.hasRuntimeSkills(h.orgId, h.danaId, true, "en")).toBe(true);

    const revoked = dispatchAgentTool(h.deps, h.ceoCtx, call("revoke_skill", { agent_name: "Dana", skill: "release-gate" }));
    expect(revoked).toContain("no longer has the Release Gate skill");
    expect(skills.hasRuntimeSkills(h.orgId, h.danaId, true, "en")).toBe(false);
  });

  test("staff cannot hand out skills", () => {
    const h = harness();
    importSkill(h, "Release Gate", "release-gate");
    const denied = dispatchAgentTool(h.deps, h.danaCtx, call("grant_skill", { agent_name: "Dana", skill: "release-gate" }));
    expect(denied).toContain("ERROR");
    expect(new SkillService(h.connection.db, "").hasRuntimeSkills(h.orgId, h.danaId, true, "en")).toBe(false);
  });

  test("the humanizer house-style skill reaches every agent without bindings and cannot be revoked", () => {
    const h = harness();
    const skills = new SkillService(h.connection.db, "");
    // A non-forced skill grants nothing on its own - not even to the CEO.
    importSkill(h, "Release Gate", "release-gate");
    expect(skills.hasRuntimeSkills(h.orgId, h.ceoId, true, "en")).toBe(false);
    expect(skills.hasRuntimeSkills(h.orgId, h.danaId, true, "en")).toBe(false);
    // Once the forced skill exists in the catalogue, everyone carries it.
    importSkill(h, "humanizer", "humanizer");
    expect(skills.hasRuntimeSkills(h.orgId, h.ceoId, true, "en")).toBe(true);
    expect(skills.hasRuntimeSkills(h.orgId, h.danaId, true, "en")).toBe(true);
    // House style is not revocable, and granting it is a no-op with feedback.
    const revoked = dispatchAgentTool(h.deps, h.ceoCtx, call("revoke_skill", { agent_name: "Dana", skill: "humanizer" }));
    expect(revoked).toContain("ERROR");
    expect(revoked).toContain("house style");
    const granted = dispatchAgentTool(h.deps, h.ceoCtx, call("grant_skill", { agent_name: "Dana", skill: "humanizer" }));
    expect(granted).toContain("automatically");
    expect(skills.hasRuntimeSkills(h.orgId, h.danaId, true, "en")).toBe(true);
  });
});
