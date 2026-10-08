import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { SkillService } from "../../src/main/services/skill-service";
import { skillBudgetTokens } from "../../src/main/services/context-budget";

const SKILL_TOKENS = skillBudgetTokens(128_000);
import { importStagedSkills, parseFrontmatter, stageBuiltinSkillsLibrary } from "../../src/main/services/builtin-skills";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";

const HUMANIZER_MD = `---
name: humanizer
version: 2.1.1
description: |
  Remove signs of AI-generated writing from text. Use when editing or reviewing
  text to make it sound more natural and human-written.
allowed-tools:
  - Read
---

# Humanizer

Write like a person: cut inflated symbolism and rule-of-three padding.
`;

const ARCHITECT_MD = `---
name: Backend Architect
description: Senior backend architect specializing in scalable system design.
color: blue
emoji: B
---

# Backend Architect Agent Personality

Design the systems that hold everything up.
`;

interface Harness {
  connection: DatabaseConnection;
  organization: OrganizationService;
  skills: SkillService;
  orgId: string;
  sourceRoot: string;
  libraryRoot: string;
}

function harness(): Harness {
  const stamp = randomUUID();
  const sourceRoot = join(tmpdir(), `ac-builtin-src-${stamp}`);
  const libraryRoot = join(tmpdir(), `ac-builtin-lib-${stamp}`);
  // Bundle fixture mirroring the real repo layout: a directory skill, a
  // category of flat skills, and non-skill folders that must be ignored.
  mkdirSync(join(sourceRoot, "humanizer"), { recursive: true });
  writeFileSync(join(sourceRoot, "humanizer", "SKILL.md"), HUMANIZER_MD, "utf8");
  writeFileSync(join(sourceRoot, "humanizer", "README.md"), "# About\n", "utf8");
  mkdirSync(join(sourceRoot, "Humanizer-zh"), { recursive: true });
  writeFileSync(
    join(sourceRoot, "Humanizer-zh", "SKILL.md"),
    "---\nname: humanizer-zh\ndescription: 去除文本中的 AI 生成痕迹。\n---\n\n像真人一样写作。\n",
    "utf8",
  );
  mkdirSync(join(sourceRoot, "engineering"), { recursive: true });
  writeFileSync(join(sourceRoot, "engineering", "engineering-backend-architect.md"), ARCHITECT_MD, "utf8");
  writeFileSync(join(sourceRoot, "engineering", "README.md"), "docs, not a skill\n", "utf8");
  mkdirSync(join(sourceRoot, "scripts"), { recursive: true });
  writeFileSync(join(sourceRoot, "scripts", "install.sh"), "#!/bin/sh\n", "utf8");

  const connection = new DatabaseConnection(join(tmpdir(), `ac-builtin-${stamp}.db`));
  const organization = new OrganizationService(connection.db);
  const skills = new SkillService(connection.db, join(tmpdir(), `ac-builtin-art-${stamp}`));
  let orgId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
  });
  return { connection, organization, skills, orgId, sourceRoot, libraryRoot };
}

describe("built-in skills", () => {
  test("stages both bundle shapes into the library and imports them once per org", () => {
    const h = harness();
    const staged = stageBuiltinSkillsLibrary(h.sourceRoot, h.libraryRoot);
    expect(staged.map((unit) => unit.slug).sort()).toEqual(["engineering-backend-architect", "humanizer", "humanizer-zh"]);
    expect(existsSync(join(h.libraryRoot, "humanizer", "SKILL.md"))).toBe(true);
    expect(existsSync(join(h.libraryRoot, "humanizer-zh", "SKILL.md"))).toBe(true);
    expect(existsSync(join(h.libraryRoot, "engineering-backend-architect", "SKILL.md"))).toBe(true);
    const architect = staged.find((unit) => unit.slug === "engineering-backend-architect");
    expect(architect?.manifest.name).toBe("Backend Architect");
    expect(architect?.manifest.description).toContain("scalable system design");
    const humanizer = staged.find((unit) => unit.slug === "humanizer");
    expect(humanizer?.manifest.version).toBe("2.1.1");
    expect(humanizer?.manifest.description).toContain("AI-generated writing");

    const first = h.connection.transaction(() => importStagedSkills(h.skills, h.orgId, staged));
    expect(first).toMatchObject({ imported: 3, skipped: 0, retired: 0, failures: [] });
    const second = h.connection.transaction(() => importStagedSkills(h.skills, h.orgId, staged));
    expect(second).toMatchObject({ imported: 0, skipped: 3, retired: 0 });
    const slugs = (h.connection.db.prepare("select slug from skill_definitions where org_id = ? order by slug").all(h.orgId) as Array<{ slug: string }>)
      .map((row) => row.slug);
    expect(slugs).toEqual(["engineering-backend-architect", "humanizer", "humanizer-zh"]);
    h.connection.close();
  });

  test("legacy catalogue entries retire so every install mirrors the bundle, while their bindings keep working", () => {
    const h = harness();
    const staged = stageBuiltinSkillsLibrary(h.sourceRoot, h.libraryRoot);
    h.connection.transaction(() => importStagedSkills(h.skills, h.orgId, staged));

    // A relic of the old ~/.agents import: active, not in the bundle, bound.
    let agentId = "";
    h.connection.transaction(() => {
      const now = new Date().toISOString();
      h.connection.db.prepare(`
        insert into skill_definitions(id, org_id, slug, name, owner_type, status, created_at)
        values ('skl_legacy', ?, 'legacy-tool', 'Legacy Tool', 'organization', 'active', ?)
      `).run(h.orgId, now);
      h.connection.db.prepare(`
        insert into skill_revisions(id, skill_id, version_semver, manifest_json, source_type, source_ref, published_at, immutable_checksum)
        values ('skr_legacy', 'skl_legacy', '1.0.0', '{"name":"Legacy Tool","requiredTools":[]}', 'local_directory', '/old', ?, 'sum')
      `).run(now);
      agentId = h.organization.createAgent({
        orgId: h.orgId, name: "Ada", role: "Engineer", department: "Engineering",
        modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null,
      });
      h.skills.bind({ orgId: h.orgId, agentId, skillId: "skl_legacy", revisionId: "skr_legacy" });
    });

    const report = h.connection.transaction(() => importStagedSkills(h.skills, h.orgId, staged));
    expect(report.retired).toBe(1);
    const legacy = h.connection.db.prepare("select status from skill_definitions where id = 'skl_legacy'").get() as { status: string };
    expect(legacy.status).toBe("retired");
    const builtinStatuses = (h.connection.db.prepare("select status from skill_definitions where org_id = ? and id <> 'skl_legacy'").all(h.orgId) as Array<{ status: string }>)
      .map((row) => row.status);
    expect(new Set(builtinStatuses)).toEqual(new Set(["active"]));
    h.connection.close();
  });

  test("every agent's run carries humanizer; hire-time skills join it and oversized grants are named, not overflowed", () => {
    const h = harness();
    // A third, oversized flat skill to prove the compiled-prompt cap.
    writeFileSync(
      join(h.sourceRoot, "engineering", "engineering-epic-novelist.md"),
      `---\nname: Epic Novelist\ndescription: too big to pack\n---\n\n${"x".repeat(SKILL_TOKENS * 3 + 30)}\n`,
      "utf8",
    );
    const staged = stageBuiltinSkillsLibrary(h.sourceRoot, h.libraryRoot);
    h.connection.transaction(() => importStagedSkills(h.skills, h.orgId, staged));

    let ceoId = "";
    h.connection.transaction(() => {
      const providerId = (h.connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(h.orgId) as { id: string }).id;
      ceoId = h.organization.createAgent({
        orgId: h.orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
      });
    });

    // The CEO hires with skills; the hire carries them plus forced humanizer.
    const providerId = (h.connection.db.prepare("select model_provider_id from agents where id = ?").get(ceoId) as { model_provider_id: string }).model_provider_id;
    const ceoCtx: AgentToolContext = {
      orgId: h.orgId,
      agent: { id: ceoId, modelProviderId: providerId, modelId: "gpt-5.4" },
      taskProjectId: null,
      taskGoalId: null, taskId: null, sourceThreadId: null,
      workspace: null,
    };
    const deps = { db: h.connection.db, organization: h.organization, chat: new ChatService(h.connection.db) };
    const hired = h.connection.transaction(() => dispatchAgentTool(deps, ceoCtx, {
      id: "call_1",
      name: "hire_agent",
      arguments: { name: "Dana Lee", role: "Engineer", department: "Engineering", skills: ["engineering-backend-architect", "engineering-epic-novelist", "no-such-skill"] },
    }));
    expect(hired).toContain("They carry: engineering-backend-architect, engineering-epic-novelist");
    expect(hired).toContain("Unknown skills skipped: no-such-skill");

    const danaId = (h.connection.db.prepare("select id from agents where org_id = ? and name = 'Dana Lee'").get(h.orgId) as { id: string }).id;
    const danaSnapshot = h.connection.transaction(() => h.skills.resolveRuntimeSnapshot({ orgId: h.orgId, agentId: danaId, runId: "run_dana", maxTokens: SKILL_TOKENS }));
    const danaPrompt = (h.connection.db.prepare("select compiled_prompt from skill_runtime_snapshots where id = ?").get(danaSnapshot) as { compiled_prompt: string }).compiled_prompt;
    expect(danaPrompt.indexOf("# Skill: humanizer")).toBe(0);
    expect(danaPrompt).toContain("# Skill: Backend Architect");
    expect(danaPrompt).toContain("Skills omitted for size");
    expect(danaPrompt).toContain("Epic Novelist");
    expect(danaPrompt.length).toBeLessThan(SKILL_TOKENS * 3 + 5_000);

    // The CEO carries humanizer too - forced by resolution, not by binding.
    expect(h.skills.hasRuntimeSkills(h.orgId, ceoId)).toBe(true);
    const ceoSnapshot = h.connection.transaction(() => h.skills.resolveRuntimeSnapshot({ orgId: h.orgId, agentId: ceoId, runId: "run_ceo", maxTokens: SKILL_TOKENS }));
    const ceoPrompt = (h.connection.db.prepare("select compiled_prompt from skill_runtime_snapshots where id = ?").get(ceoSnapshot) as { compiled_prompt: string }).compiled_prompt;
    expect(ceoPrompt).toContain("# Skill: humanizer");
    expect(ceoPrompt).not.toContain("# Skill: Backend Architect");

    // list_skills shows descriptions and marks the house-style skill.
    const listing = dispatchAgentTool(deps, ceoCtx, { id: "call_2", name: "list_skills", arguments: {} });
    expect(listing).toContain("humanizer (humanizer)");
    expect(listing).toContain("house style");
    expect(listing).toContain("Backend Architect (engineering-backend-architect) — Senior backend architect");
    h.connection.close();
  });

  test("the forced humanizer follows the app language, with cross-language fallback", () => {
    const h = harness();
    const staged = stageBuiltinSkillsLibrary(h.sourceRoot, h.libraryRoot);
    h.connection.transaction(() => importStagedSkills(h.skills, h.orgId, staged));
    let agentId = "";
    h.connection.transaction(() => {
      agentId = h.organization.createAgent({
        orgId: h.orgId, name: "Ada", role: "Engineer", department: "Engineering",
        modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null,
      });
    });
    const promptFor = (runId: string) => {
      const snapshotId = h.connection.transaction(() => h.skills.resolveRuntimeSnapshot({ orgId: h.orgId, agentId, runId, maxTokens: SKILL_TOKENS }));
      return (h.connection.db.prepare("select compiled_prompt from skill_runtime_snapshots where id = ?").get(snapshotId) as { compiled_prompt: string }).compiled_prompt;
    };

    // English UI (default): the English humanizer, and only that one.
    const englishPrompt = promptFor("run_lang_en");
    expect(englishPrompt).toContain("# Skill: humanizer");
    expect(englishPrompt).not.toContain("humanizer-zh");

    // Chinese UI: the Chinese variant replaces it.
    h.connection.transaction(() => h.organization.updateUiPreferences({ language: "zh" }));
    const chinesePrompt = promptFor("run_lang_zh");
    expect(chinesePrompt).toContain("# Skill: humanizer-zh");
    expect(chinesePrompt).not.toContain("# Skill: humanizer\n");

    // Chinese UI against a catalogue without the zh variant falls back to
    // English house style instead of silently dropping it.
    h.connection.transaction(() => {
      h.connection.db.prepare("update skill_definitions set status = 'retired' where org_id = ? and slug = 'humanizer-zh'").run(h.orgId);
    });
    const fallbackPrompt = promptFor("run_lang_fallback");
    expect(fallbackPrompt).toContain("# Skill: humanizer");
    h.connection.close();
  });

  test("frontmatter parsing reads inline values and block scalars", () => {
    expect(parseFrontmatter(ARCHITECT_MD)).toMatchObject({
      name: "Backend Architect",
      description: "Senior backend architect specializing in scalable system design.",
    });
    expect(parseFrontmatter(HUMANIZER_MD)).toMatchObject({ name: "humanizer", version: "2.1.1" });
    expect(parseFrontmatter(HUMANIZER_MD).description).toContain("sound more natural and human-written");
    expect(parseFrontmatter("no frontmatter")).toEqual({});
  });

  test("no skill, not even the first forced one, may exceed the skill budget", () => {
    const h = harness();
    const staged = stageBuiltinSkillsLibrary(h.sourceRoot, h.libraryRoot);
    h.connection.transaction(() => importStagedSkills(h.skills, h.orgId, staged));
    let agentId = "";
    h.connection.transaction(() => {
      agentId = h.organization.createAgent({
        orgId: h.orgId, name: "Ada", role: "Engineer", department: "Engineering",
        modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null,
      });
    });
    const snapshotId = h.connection.transaction(() => h.skills.resolveRuntimeSnapshot({ orgId: h.orgId, agentId, runId: "run_tiny", maxTokens: 10 }));
    const prompt = (h.connection.db.prepare("select compiled_prompt from skill_runtime_snapshots where id = ?").get(snapshotId) as { compiled_prompt: string }).compiled_prompt;
    expect(prompt).not.toContain("# Skill:");
    expect(prompt).toContain("# Skills omitted for size");
    expect(prompt).toContain("humanizer");
    h.connection.close();
  });
});
