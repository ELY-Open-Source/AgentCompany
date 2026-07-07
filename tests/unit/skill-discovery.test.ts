import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SkillService } from "../../src/main/services/skill-service";
import { syncSkillsFromDisk } from "../../src/main/services/skill-discovery";

interface Harness {
  connection: DatabaseConnection;
  skills: SkillService;
  orgId: string;
  globalRoot: string;
  workspaceRoot: string;
}

function harness(): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-skdisc-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  const workspaceRoot = join(tmpdir(), `ac-skdisc-ws-${randomUUID()}`);
  mkdirSync(workspaceRoot, { recursive: true });
  let orgId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
    organization.createWorkspace({ orgId, name: "HQ", localPath: workspaceRoot, projectId: null });
  });
  const globalRoot = join(tmpdir(), `ac-skdisc-global-${randomUUID()}`);
  mkdirSync(globalRoot, { recursive: true });
  const artifactRoot = join(tmpdir(), `ac-skdisc-art-${randomUUID()}`);
  return { connection, skills: new SkillService(connection.db, artifactRoot), orgId, globalRoot, workspaceRoot };
}

function writeManifestSkill(root: string, dirName: string, name: string): void {
  const dir = join(root, dirName);
  mkdirSync(join(dir, "checks"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `Guide for ${name}.\n`, "utf8");
  writeFileSync(join(dir, "checks", "acceptance.txt"), "accepted\n", "utf8");
  writeFileSync(join(dir, "skill.manifest.json"), JSON.stringify({
    name,
    version: "1.0.0",
    entrypoint: "SKILL.md",
    capabilities: ["review"],
    required_tools: ["git"],
    compatible_models: ["gpt-5.4"],
    risk_level: "low",
    tests: ["checks/acceptance.txt"],
    inputs: {},
    outputs: {},
  }, null, 2), "utf8");
}

function writeMarkdownOnlySkill(root: string, dirName: string, frontmatterName: string | null): void {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  const frontmatter = frontmatterName ? `---\nname: ${frontmatterName}\ndescription: does things\n---\n\n` : "";
  writeFileSync(join(dir, "SKILL.md"), `${frontmatter}# Steps\nDo the thing.\n`, "utf8");
}

function skillNames(h: Harness): string[] {
  return (h.connection.db.prepare("select name from skill_definitions where org_id = ? order by name asc").all(h.orgId) as Array<{ name: string }>)
    .map((row) => row.name);
}

describe("skill discovery", () => {
  test("imports skills from the global directory and every workspace", () => {
    const h = harness();
    writeManifestSkill(h.globalRoot, "release-gate", "Release Gate");
    writeMarkdownOnlySkill(join(h.workspaceRoot, ".agents", "skills"), "code-style", "Code Style");

    const report = syncSkillsFromDisk(h.connection.db, h.skills, h.orgId, h.globalRoot);
    expect(report.imported).toBe(2);
    expect(report.failures).toEqual([]);
    expect(skillNames(h)).toEqual(["Code Style", "Release Gate"]);
  });

  test("a SKILL.md without frontmatter falls back to the directory name", () => {
    const h = harness();
    writeMarkdownOnlySkill(h.globalRoot, "incident-runbook", null);
    syncSkillsFromDisk(h.connection.db, h.skills, h.orgId, h.globalRoot);
    expect(skillNames(h)).toEqual(["incident-runbook"]);
  });

  test("re-syncing skips what the org already carries", () => {
    const h = harness();
    writeManifestSkill(h.globalRoot, "release-gate", "Release Gate");
    syncSkillsFromDisk(h.connection.db, h.skills, h.orgId, h.globalRoot);
    const second = syncSkillsFromDisk(h.connection.db, h.skills, h.orgId, h.globalRoot);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
    expect(skillNames(h)).toEqual(["Release Gate"]);
  });

  test("one broken directory cannot block the rest", () => {
    const h = harness();
    writeManifestSkill(h.globalRoot, "good", "Good Skill");
    const broken = join(h.globalRoot, "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "skill.manifest.json"), "{ not json", "utf8");
    writeFileSync(join(broken, "SKILL.md"), "x", "utf8");

    const report = syncSkillsFromDisk(h.connection.db, h.skills, h.orgId, h.globalRoot);
    expect(report.imported).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(skillNames(h)).toEqual(["Good Skill"]);
  });
});
