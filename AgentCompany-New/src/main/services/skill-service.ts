import { existsSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { BindSkillInput, ImportSkillDirectoryInput, ResolveAgentSkillsInput } from "../../shared/commands";
import { SLO_SIGNAL_KEY } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { OperationsService } from "./operations-service";
import { copySkillRevision, recursiveSkillChecksum } from "./skill-artifacts";
import { loadSkillManifest, type SkillManifest } from "./skill-manifest";

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export class SkillService {
  private readonly audit: AuditService;
  private readonly operations: OperationsService;

  constructor(private readonly db: DatabaseSync, private readonly artifactRoot: string) {
    this.audit = new AuditService(db);
    this.operations = new OperationsService(db);
  }

  importDirectory(input: ImportSkillDirectoryInput): string {
    const manifest = loadSkillManifest(input.directoryPath, input.versionSemver);
    const slug = slugify(manifest.name);
    if (!slug) throw new Error("Skill name could not be derived.");
    const now = new Date().toISOString();
    const skillId = createId("skl");
    const revisionId = createId("skr");
    const checksum = recursiveSkillChecksum(input.directoryPath);
    const copiedFiles = copySkillRevision(input.directoryPath, this.artifactRoot, revisionId);
    const copiedEntrypoint = copiedFiles.find((file) => file.relativePath === manifest.entrypoint);
    if (!copiedEntrypoint) throw new Error("Skill manifest entrypoint was not found.");

    this.db.prepare(`
      insert into skill_definitions(id, org_id, slug, name, owner_type, status, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(org_id, slug) do update set name = excluded.name, status = 'active'
    `).run(skillId, input.orgId, slug, manifest.name, "organization", "active", now);

    const existing = this.db.prepare("select id from skill_definitions where org_id = ? and slug = ?")
      .get(input.orgId, slug) as { id: string };

    this.db.prepare(`
      insert into skill_revisions(
        id, skill_id, version_semver, manifest_json, source_type, source_ref, published_at, immutable_checksum
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revisionId,
      existing.id,
      manifest.version,
      JSON.stringify(manifest),
      "local_directory",
      input.directoryPath,
      now,
      checksum,
    );
    for (const file of copiedFiles) {
      this.db.prepare(`
        insert into skill_artifacts(id, revision_id, artifact_type, object_key, sha256, size_bytes)
        values (?, ?, ?, ?, ?, ?)
      `).run(createId("ska"), revisionId, artifactType(file.relativePath, manifest), file.objectKey, file.sha256, file.sizeBytes);
    }
    for (const testPath of manifest.tests) {
      this.db.prepare(`
        insert into skill_tests(id, revision_id, test_type, expected_output_ref, last_result, last_run_at)
        values (?, ?, ?, ?, ?, ?)
      `).run(createId("skt"), revisionId, "manifest", testPath, null, null);
    }

    this.audit.record({
      orgId: input.orgId,
      entityType: "skill_revision",
      entityId: revisionId,
      actorType: "system",
      actorId: null,
      action: "published",
      payload: { slug, version: manifest.version },
    });
    return revisionId;
  }

  bind(input: BindSkillInput): string {
    this.verifyBindingTargets(input);
    const existing = this.db.prepare("select id from skill_bindings where agent_id = ? and skill_id = ?")
      .get(input.agentId, input.skillId) as { id: string } | undefined;
    const id = existing?.id ?? createId("skb");
    if (existing) {
      this.db.prepare(`
        update skill_bindings
        set pinned_revision_id = ?, binding_mode = ?, priority = ?, enabled = ?
        where id = ? and org_id = ?
      `).run(input.revisionId, "pinned", 100, 1, id, input.orgId);
    } else {
      this.db.prepare(`
        insert into skill_bindings(id, org_id, agent_id, skill_id, pinned_revision_id, binding_mode, priority, enabled)
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.orgId, input.agentId, input.skillId, input.revisionId, "pinned", 100, 1);
    }
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
    const existingSnapshot = this.db.prepare("select id from skill_runtime_snapshots where agent_id = ? and run_id = ?")
      .get(input.agentId, input.runId) as { id: string } | undefined;
    if (existingSnapshot) throw new Error("Skill runtime snapshot already exists for this run.");
    const rows = this.db.prepare(`
      select
        sr.id as revision_id,
        sr.version_semver,
        sr.manifest_json,
        sa.object_key
      from skill_bindings sb
      join skill_revisions sr on sr.id = sb.pinned_revision_id
      join skill_artifacts sa on sa.revision_id = sr.id and sa.artifact_type in ('entrypoint', 'markdown')
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
    this.operations.recordSignal({
      orgId: input.orgId,
      signalKey: SLO_SIGNAL_KEY.SKILL_RESOLVE_SUCCESS,
      source: "skill_resolver",
      success: true,
      durationMs: null,
      detail: { agentId: input.agentId, runId: input.runId, revisionIds },
    });
    return snapshotId;
  }

  private verifyBindingTargets(input: BindSkillInput): void {
    const agent = this.db.prepare("select id from agents where id = ? and org_id = ?")
      .get(input.agentId, input.orgId) as { id: string } | undefined;
    if (!agent) throw new Error("Agent was not found.");
    const skill = this.db.prepare("select id from skill_definitions where id = ? and org_id = ?")
      .get(input.skillId, input.orgId) as { id: string } | undefined;
    if (!skill) throw new Error("Skill was not found.");
    const revision = this.db.prepare("select id from skill_revisions where id = ? and skill_id = ?")
      .get(input.revisionId, input.skillId) as { id: string } | undefined;
    if (!revision) throw new Error("Skill revision was not found.");
  }
}

function artifactType(relativePath: string, manifest: SkillManifest): string {
  if (relativePath === "skill.manifest.json") return "manifest";
  if (relativePath === manifest.entrypoint) return "entrypoint";
  if (manifest.tests.includes(relativePath)) return "test";
  return "asset";
}

interface RuntimeSkillRow {
  revision_id: string;
  version_semver: string;
  manifest_json: string;
  object_key: string;
}
