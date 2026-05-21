import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { BindSkillInput, ImportSkillDirectoryInput, ResolveAgentSkillsInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

interface SkillManifest {
  name: string;
  version: string;
  entrypoint: string;
  capabilities: string[];
  requiredTools: string[];
  compatibleModels: string[];
  riskLevel: string;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseSkillName(markdown: string, directoryPath: string): string {
  const frontmatterName = markdown.match(/^---[\s\S]*?\nname:\s*["']?([^"'\n]+)["']?/m)?.[1];
  if (frontmatterName) return frontmatterName.trim();
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1];
  return heading?.trim() || basename(directoryPath);
}

function hashFiles(directoryPath: string): string {
  const hash = createHash("sha256");
  const files = readdirSync(directoryPath).filter((name) => !name.startsWith(".")).sort();
  for (const file of files) {
    const path = join(directoryPath, file);
    const stats = statSync(path);
    if (stats.isFile()) {
      hash.update(file);
      hash.update(readFileSync(path));
    }
  }
  return hash.digest("hex");
}

export class SkillService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  importDirectory(input: ImportSkillDirectoryInput): string {
    const skillPath = join(input.directoryPath, "SKILL.md");
    if (!existsSync(skillPath)) throw new Error("SKILL.md was not found in the selected directory.");
    const markdown = readFileSync(skillPath, "utf8");
    const name = parseSkillName(markdown, input.directoryPath);
    const slug = slugify(name);
    if (!slug) throw new Error("Skill name could not be derived.");
    const now = new Date().toISOString();
    const skillId = createId("skl");
    const revisionId = createId("skr");
    const checksum = hashFiles(input.directoryPath);
    const manifest: SkillManifest = {
      name,
      version: input.versionSemver,
      entrypoint: "SKILL.md",
      capabilities: [],
      requiredTools: [],
      compatibleModels: ["openai/*", "anthropic/*", "xai/*"],
      riskLevel: "medium",
    };

    this.db.prepare(`
      insert into skill_definitions(id, org_id, slug, name, owner_type, status, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(org_id, slug) do update set name = excluded.name, status = 'active'
    `).run(skillId, input.orgId, slug, name, "organization", "active", now);

    const existing = this.db.prepare("select id from skill_definitions where org_id = ? and slug = ?")
      .get(input.orgId, slug) as { id: string };

    this.db.prepare(`
      insert into skill_revisions(
        id, skill_id, version_semver, manifest_json, source_type, source_ref, published_at, immutable_checksum
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revisionId,
      existing.id,
      input.versionSemver,
      JSON.stringify(manifest),
      "local_directory",
      input.directoryPath,
      now,
      checksum,
    );
    this.db.prepare(`
      insert into skill_artifacts(id, revision_id, artifact_type, object_key, sha256, size_bytes)
      values (?, ?, ?, ?, ?, ?)
    `).run(createId("ska"), revisionId, "markdown", skillPath, checksum, Buffer.byteLength(markdown));

    this.audit.record({
      orgId: input.orgId,
      entityType: "skill_revision",
      entityId: revisionId,
      actorType: "system",
      actorId: null,
      action: "published",
      payload: { slug, version: input.versionSemver },
    });
    return revisionId;
  }

  bind(input: BindSkillInput): string {
    const id = createId("skb");
    this.db.prepare(`
      insert into skill_bindings(id, org_id, agent_id, skill_id, pinned_revision_id, binding_mode, priority, enabled)
      values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(agent_id, skill_id) do update set pinned_revision_id = excluded.pinned_revision_id, enabled = 1
    `).run(id, input.orgId, input.agentId, input.skillId, input.revisionId, "pinned", 100, 1);
    this.audit.record({
      orgId: input.orgId,
      entityType: "skill_binding",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "bound",
      payload: { agentId: input.agentId, skillId: input.skillId, revisionId: input.revisionId },
    });
    return id;
  }

  resolveRuntimeSnapshot(input: ResolveAgentSkillsInput): string {
    const agent = this.db.prepare("select id from agents where id = ? and org_id = ?")
      .get(input.agentId, input.orgId) as { id: string } | undefined;
    if (!agent) throw new Error("Agent was not found.");
    const rows = this.db.prepare(`
      select
        sr.id as revision_id,
        sr.version_semver,
        sr.manifest_json,
        sa.object_key
      from skill_bindings sb
      join skill_revisions sr on sr.id = sb.pinned_revision_id
      join skill_artifacts sa on sa.revision_id = sr.id and sa.artifact_type = 'markdown'
      where sb.org_id = ? and sb.agent_id = ? and sb.enabled = 1
      order by sb.priority asc, sr.published_at asc
    `).all(input.orgId, input.agentId) as unknown as RuntimeSkillRow[];
    if (rows.length === 0) throw new Error("Agent has no enabled skills.");

    const compiledParts: string[] = [];
    const tools = new Set<string>();
    const revisionIds: string[] = [];
    for (const row of rows) {
      if (!existsSync(row.object_key)) throw new Error(`Skill artifact is missing: ${row.object_key}`);
      const manifest = JSON.parse(row.manifest_json) as SkillManifest;
      for (const tool of manifest.requiredTools) tools.add(tool);
      revisionIds.push(row.revision_id);
      compiledParts.push([
        `# Skill: ${manifest.name}`,
        `Version: ${row.version_semver}`,
        readFileSync(row.object_key, "utf8").trim(),
      ].join("\n\n"));
    }

    const snapshotId = createId("srs");
    this.db.prepare(`
      insert into skill_runtime_snapshots(
        id, agent_id, run_id, compiled_prompt, tools_manifest, source_revision_ids, created_at
      )
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      input.agentId,
      input.runId,
      compiledParts.join("\n\n---\n\n"),
      JSON.stringify({ requiredTools: [...tools].sort() }),
      JSON.stringify(revisionIds),
      new Date().toISOString(),
    );
    this.audit.record({
      orgId: input.orgId,
      entityType: "skill_runtime_snapshot",
      entityId: snapshotId,
      actorType: "system",
      actorId: null,
      action: "resolved",
      payload: { agentId: input.agentId, runId: input.runId, revisionIds },
    });
    return snapshotId;
  }
}

interface RuntimeSkillRow {
  revision_id: string;
  version_semver: string;
  manifest_json: string;
  object_key: string;
}
