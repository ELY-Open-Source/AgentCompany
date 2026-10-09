import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SkillService } from "../../src/main/services/skill-service";
import { modelCompatible } from "../../src/main/services/skill-runtime";

describe("skill compatibility", () => {
  test("model patterns match provider/model or the bare model name", () => {
    expect(modelCompatible([], { providerKey: "openai", model: null })).toBe(true);
    expect(modelCompatible(["openai/*"], { providerKey: "openai", model: "gpt-5.4" })).toBe(true);
    expect(modelCompatible(["gpt-5.4"], { providerKey: "openai", model: "gpt-5.4" })).toBe(true);
    expect(modelCompatible(["gpt-5.?"], { providerKey: "openai", model: "gpt-5.4" })).toBe(false);
    expect(modelCompatible(["anthropic/*"], { providerKey: "openai", model: "gpt-5.4" })).toBe(false);
    expect(modelCompatible(["openai/*"], { providerKey: "openai", model: null })).toBe(false);
  });

  test("a run loads only skills compatible with its model and states each skill's contract", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-compat-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const skills = new SkillService(connection.db, join(tmpdir(), `ac-compat-art-${randomUUID()}`));
    const skillDir = join(tmpdir(), `ac-compat-skill-${randomUUID()}`);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Claude Review\n\nReview with care.\n");
    writeFileSync(join(skillDir, "skill.manifest.json"), JSON.stringify({
      name: "claude-review", version: "1.0.0", entrypoint: "SKILL.md", capabilities: [], required_tools: [],
      compatible_models: ["anthropic/*"], risk_level: "high", inputs: "A patch diff", outputs: { verdict: "markdown" }, tests: [],
    }));
    let orgId = "";
    let agentId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "C", employeeName: "Y", mission: "m", goal: "g" });
      agentId = organization.createAgent({
        orgId, name: "Ada", role: "Reviewer", department: "Engineering",
        modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null,
      });
      const revisionId = skills.importDirectory({ orgId, directoryPath: skillDir, versionSemver: "1.0.0" });
      const skill = connection.db.prepare("select id from skill_definitions where org_id = ? and slug = 'claude-review'").get(orgId) as { id: string };
      skills.bind({ orgId, agentId, skillId: skill.id, revisionId });
    });
    const prompt = (runId: string, providerKey: string, model: string) => {
      const id = connection.transaction(() => skills.resolveRuntimeSnapshot({ orgId, agentId, runId, maxTokens: 40_000, taskText: "", runModel: { providerKey, model }, houseStyle: true, language: "en" }));
      return connection.db.prepare("select compiled_prompt, source_revision_ids from skill_runtime_snapshots where id = ?").get(id) as { compiled_prompt: string; source_revision_ids: string };
    };

    const openai = prompt("run_openai", "openai", "gpt-5.4");
    expect(openai.compiled_prompt).not.toContain("# Skill: claude-review");
    expect(openai.compiled_prompt).toContain("# Skills not loaded\n\nThese granted skills do not support this run's model (openai/gpt-5.4): claude-review (anthropic/*).");
    expect(JSON.parse(openai.source_revision_ids)).toEqual([]);

    const anthropic = prompt("run_anthropic", "anthropic", "claude-sonnet-5-5");
    expect(anthropic.compiled_prompt).toContain([
      "# Skill: claude-review", "Version: 1.0.0", "Risk: high",
      "Expects as input: A patch diff", 'Must produce: {"verdict":"markdown"}',
    ].join("\n"));
    const recovered = prompt("run_anthropic", "openai", "gpt-5.4");
    expect(recovered.compiled_prompt).not.toContain("# Skill: claude-review");
    expect(recovered.compiled_prompt).toContain("# Skills not loaded");
    connection.close();
  });
});
