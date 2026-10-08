import { existsSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { BindSkillInput, ImportSkillDirectoryInput, ResolveAgentSkillsInput, RunSkillTestsInput } from "../../shared/commands";
import { SLO_SIGNAL_KEY } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { OperationsService } from "./operations-service";
import { copySkillRevision, recursiveSkillChecksum } from "./skill-artifacts";
import { loadSkillManifest, type SkillManifest } from "./skill-manifest";
import { orderByRelevance } from "./relevance";
import { runManifestArtifactTest, verifyRevisionStructure, type SkillArtifactRow, type SkillTestRow } from "./skill-tests";
import { estimateTokens } from "./context-budget";

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * House-style humanizer skills, one per app language. Every agent carries
 * the variant matching the current UI language on every run, CEO included.
 * They are a resolution rule, not a binding row, so no creation path — hire
 * tool, onboarding, tests, raw SQL — can produce an agent without one.
 * Both variants are protected from grant/revoke.
 */
export const HUMANIZER_SLUG_EN = "humanizer";
export const HUMANIZER_SLUG_ZH = "humanizer-zh";
export const FORCED_SKILL_SLUGS = [HUMANIZER_SLUG_EN, HUMANIZER_SLUG_ZH] as const;

/**
 * Preference order for the forced skill: the language-matched variant first,
 * the other variant as a fallback so a catalogue that predates the Chinese
 * skill never silently loses house style.
 */
export function forcedSkillSlugCandidates(language: string): string[] {
  return language === "zh" ? [HUMANIZER_SLUG_ZH, HUMANIZER_SLUG_EN] : [HUMANIZER_SLUG_EN, HUMANIZER_SLUG_ZH];
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
    return this.importManifest(input.orgId, input.directoryPath, manifest);
  }

  /** True when the org already carries a skill under this slug (or name). */
  hasSkill(orgId: string, slugOrName: string): boolean {
    const slug = slugify(slugOrName);
    return Boolean(this.db.prepare("select id from skill_definitions where org_id = ? and slug = ?").get(orgId, slug));
  }

  /**
   * Retires every active skill whose slug is not in `keepSlugs`, so the org
   * catalogue mirrors the shipped bundle. Retired skills leave list_skills,
   * cannot be granted, and stop loading into runs; their bindings stay so a
   * restore brings them back. Returns the retired slugs.
   */
  retireSkillsNotIn(orgId: string, keepSlugs: string[]): string[] {
    const keep = new Set(keepSlugs);
    const active = this.db.prepare("select id, slug from skill_definitions where org_id = ? and status = 'active'")
      .all(orgId) as Array<{ id: string; slug: string }>;
    const retired: string[] = [];
    for (const skill of active) {
      if (keep.has(skill.slug)) continue;
      this.db.prepare("update skill_definitions set status = 'retired' where id = ?").run(skill.id);
      this.audit.record({
        orgId,
        entityType: "skill_definition",
        entityId: skill.id,
        actorType: "system",
        actorId: null,
        action: "retired",
        payload: { slug: skill.slug, reason: "not_in_builtin_bundle" },
      });
      retired.push(skill.slug);
    }
    return retired;
  }

  /** Reactivates a retired skill; returns whether it was retired. */
  restoreIfRetired(orgId: string, slug: string): boolean {
    const skill = this.db.prepare("select id from skill_definitions where org_id = ? and slug = ? and status = 'retired'")
      .get(orgId, slug) as { id: string } | undefined;
    if (!skill) return false;
    this.db.prepare("update skill_definitions set status = 'active' where id = ?").run(skill.id);
    this.audit.record({
      orgId,
      entityType: "skill_definition",
      entityId: skill.id,
      actorType: "system",
      actorId: null,
      action: "restored",
      payload: { slug, reason: "back_in_builtin_bundle" },
    });
    return true;
  }

  /** Publishes a new revision when the files changed and moves bindings on the latest revision onto it. */
  upgradeIfChanged(orgId: string, directoryPath: string, manifest: SkillManifest, slug: string): boolean {
    const latest = this.db.prepare(`
      select sr.id, sr.immutable_checksum from skill_definitions sd
      join skill_revisions sr on sr.skill_id = sd.id
      where sd.org_id = ? and sd.slug = ?
      order by sr.published_at desc, sr.rowid desc limit 1
    `).get(orgId, slug) as { id: string; immutable_checksum: string } | undefined;
    if (!latest) throw new Error(`Skill "${slug}" has no revision to upgrade.`);
    const checksum = recursiveSkillChecksum(directoryPath);
    if (latest.immutable_checksum === checksum) return false;
    const revisions = this.db.prepare(`
      select sr.version_semver from skill_revisions sr join skill_definitions sd on sd.id = sr.skill_id
      where sd.org_id = ? and sd.slug = ?
    `).all(orgId, slug) as Array<{ version_semver: string }>;
    // Same declared version, new content: tag the build so revisions stay distinct.
    const versionTaken = revisions.some((row) => row.version_semver === manifest.version);
    const published = versionTaken ? { ...manifest, version: `${manifest.version}+rev${revisions.length + 1}` } : manifest;
    const revisionId = this.importManifest(orgId, directoryPath, published, slug);
    const moved = this.db.prepare("update skill_bindings set pinned_revision_id = ? where org_id = ? and pinned_revision_id = ?")
      .run(revisionId, orgId, latest.id);
    this.audit.record({
      orgId,
      entityType: "skill_revision",
      entityId: revisionId,
      actorType: "system",
      actorId: null,
      action: "upgraded",
      payload: { slug, fromRevisionId: latest.id, version: published.version, bindingsMoved: Number(moved.changes) },
    });
    return true;
  }

  importManifest(orgId: string, directoryPath: string, manifest: SkillManifest, explicitSlug?: string): string {
    const slug = explicitSlug ?? slugify(manifest.name);
    if (!slug) throw new Error("Skill name could not be derived.");
    const now = new Date().toISOString();
    const skillId = createId("skl");
    const revisionId = createId("skr");
    const checksum = recursiveSkillChecksum(directoryPath);
    const copiedFiles = copySkillRevision(directoryPath, this.artifactRoot, revisionId);
    const copiedEntrypoint = copiedFiles.find((file) => file.relativePath === manifest.entrypoint);
    if (!copiedEntrypoint) throw new Error("Skill manifest entrypoint was not found.");

    this.db.prepare(`
      insert into skill_definitions(id, org_id, slug, name, owner_type, status, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(org_id, slug) do update set name = excluded.name, status = 'active'
    `).run(skillId, orgId, slug, manifest.name, "organization", "active", now);

    const existing = this.db.prepare("select id from skill_definitions where org_id = ? and slug = ?")
      .get(orgId, slug) as { id: string };

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
      directoryPath,
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
      orgId,
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

  unbind(input: { orgId: string; agentId: string; skillId: string }): void {
    const existing = this.db.prepare("select id from skill_bindings where org_id = ? and agent_id = ? and skill_id = ?")
      .get(input.orgId, input.agentId, input.skillId) as { id: string } | undefined;
    if (!existing) return;
    this.db.prepare("delete from skill_bindings where id = ?").run(existing.id);
    this.audit.record({
      orgId: input.orgId,
      entityType: "skill_binding",
      entityId: existing.id,
      actorType: "system",
      actorId: null,
      action: "unbound",
      payload: { agentId: input.agentId, skillId: input.skillId },
    });
  }

  /**
   * True when a run for this agent would compile at least one skill: every
   * agent carries the forced house-style skill once the catalogue holds a
   * language variant, plus whatever bindings the CEO granted.
   */
  hasRuntimeSkills(orgId: string, agentId: string): boolean {
    if (this.forcedSkillRows(orgId).length > 0) return true;
    return Boolean(this.db.prepare(`
      select sb.id from skill_bindings sb join skill_definitions sd on sd.id = sb.skill_id and sd.status = 'active'
      where sb.org_id = ? and sb.agent_id = ? and sb.enabled = 1 limit 1
    `).get(orgId, agentId));
  }

  /**
   * The single forced house-style skill for the current app language:
   * queries both humanizer variants and keeps the best match by preference
   * order (language-matched first, other variant as fallback).
   */
  private forcedSkillRows(orgId: string): RuntimeSkillRow[] {
    const candidates = forcedSkillSlugCandidates(this.appLanguage());
    const rows = this.db.prepare(`
      select
        sd.id as skill_id,
        sd.slug as slug,
        sr.id as revision_id,
        sr.version_semver,
        sr.manifest_json,
        sa.object_key
      from skill_definitions sd
      join skill_revisions sr on sr.id = (
        select id from skill_revisions where skill_id = sd.id order by published_at desc, rowid desc limit 1
      )
      join skill_artifacts sa on sa.revision_id = sr.id and sa.artifact_type in ('entrypoint', 'markdown')
      where sd.org_id = ? and sd.status = 'active' and sd.slug in (${candidates.map(() => "?").join(", ")})
    `).all(orgId, ...candidates) as unknown as Array<RuntimeSkillRow & { slug: string }>;
    for (const slug of candidates) {
      const match = rows.find((row) => row.slug === slug);
      if (match) return [match];
    }
    return [];
  }

  private carriesRetiredSkill(revisionIds: string[]): boolean {
    if (revisionIds.length === 0) return false;
    return Boolean(this.db.prepare(`
      select 1 from skill_revisions sr join skill_definitions sd on sd.id = sr.skill_id
      where sd.status <> 'active' and sr.id in (${revisionIds.map(() => "?").join(", ")}) limit 1
    `).get(...revisionIds));
  }

  private appLanguage(): string {
    const row = this.db.prepare("select language from app_state where id = 1").get() as { language: string } | undefined;
    return row?.language === "zh" ? "zh" : "en";
  }

  /**
   * Freezes the exact skill set this run carries: forced house-style skills
   * first (identical for everyone, CEO included), then the agent's enabled
   * bindings, most relevant to the task first, deduplicated per skill. Skills pack whole
   * until input.maxTokens; whatever does not fit is named in the compiled
   * prompt instead of silently overflowing the model's context.
   */
  resolveRuntimeSnapshot(input: ResolveAgentSkillsInput): string {
    // Idempotent per run: a re-queued run reuses its frozen skill set unless a skill in it was retired since.
    const existingSnapshot = this.db.prepare("select id, source_revision_ids from skill_runtime_snapshots where agent_id = ? and run_id = ?")
      .get(input.agentId, input.runId) as { id: string; source_revision_ids: string } | undefined;
    if (existingSnapshot) {
      if (!this.carriesRetiredSkill(JSON.parse(existingSnapshot.source_revision_ids) as string[])) return existingSnapshot.id;
      this.db.prepare("delete from skill_runtime_snapshots where id = ?").run(existingSnapshot.id);
    }
    const forcedRows = this.forcedSkillRows(input.orgId);
    const boundRows = this.db.prepare(`
      select
        sb.skill_id as skill_id,
        sr.id as revision_id,
        sr.version_semver,
        sr.manifest_json,
        sa.object_key
      from skill_bindings sb
      join skill_definitions sd on sd.id = sb.skill_id and sd.status = 'active'
      join skill_revisions sr on sr.id = sb.pinned_revision_id
      join skill_artifacts sa on sa.revision_id = sr.id and sa.artifact_type in ('entrypoint', 'markdown')
      where sb.org_id = ? and sb.agent_id = ? and sb.enabled = 1
      order by sb.priority asc, sr.published_at asc
    `).all(input.orgId, input.agentId) as unknown as RuntimeSkillRow[];
    const rows: RuntimeSkillRow[] = [];
    const seenSkillIds = new Set<string>();
    const relevantBound = orderByRelevance(boundRows, (row) => {
      const manifest = JSON.parse(row.manifest_json) as SkillManifest;
      return `${manifest.name} ${manifest.description ?? ""}`;
    }, input.taskText);
    for (const row of [...forcedRows, ...relevantBound]) {
      if (seenSkillIds.has(row.skill_id)) continue;
      seenSkillIds.add(row.skill_id);
      rows.push(row);
    }
    if (rows.length === 0) throw new Error("Agent has no enabled skills.");

    const compiledParts: string[] = [];
    const tools = new Set<string>();
    const revisionIds: string[] = [];
    const omitted: string[] = [];
    let compiledTokens = 0;
    for (const row of rows) {
      if (!existsSync(row.object_key)) throw new Error(`Skill artifact is missing: ${row.object_key}`);
      const manifest = JSON.parse(row.manifest_json) as SkillManifest;
      const part = [
        `# Skill: ${manifest.name}`,
        `Version: ${row.version_semver}`,
        readFileSync(row.object_key, "utf8").trim(),
      ].join("\n\n");
      const partTokens = estimateTokens(part);
      if (compiledTokens + partTokens > input.maxTokens) {
        omitted.push(manifest.name);
        continue;
      }
      for (const tool of manifest.requiredTools) tools.add(tool);
      revisionIds.push(row.revision_id);
      compiledParts.push(part);
      compiledTokens += partTokens;
    }
    if (omitted.length > 0) {
      compiledParts.push(
        `# Skills omitted for size\n\nThese granted skills did not fit this run's prompt budget: ${omitted.join(", ")}. Ask the CEO to trim grants if they are essential.`,
      );
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

  runTests(input: RunSkillTestsInput): string {
    const revision = this.db.prepare(`
      select sr.id, sr.version_semver, sd.slug
      from skill_revisions sr
      join skill_definitions sd on sd.id = sr.skill_id
      where sr.id = ? and sd.org_id = ?
    `).get(input.revisionId, input.orgId) as SkillRevisionTestRow | undefined;
    if (!revision) throw new Error("Skill revision was not found.");

    const tests = this.db.prepare(`
      select id, test_type, expected_output_ref
      from skill_tests
      where revision_id = ?
      order by expected_output_ref asc
    `).all(input.revisionId) as unknown as SkillTestRow[];
    const artifacts = this.db.prepare(`
      select artifact_type, object_key, sha256, size_bytes
      from skill_artifacts
      where revision_id = ?
      order by artifact_type asc, object_key asc
    `).all(input.revisionId) as unknown as SkillArtifactRow[];
    const structureFailure = verifyRevisionStructure(artifacts);
    if (structureFailure && tests.length === 0) throw new Error(structureFailure.failure ?? "Skill revision structure check failed.");
    const now = new Date().toISOString();
    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      const result = structureFailure ?? runManifestArtifactTest(test, artifacts);
      if (result.status === "passed") passed += 1;
      if (result.status === "failed") failed += 1;
      this.db.prepare("update skill_tests set last_result = ?, last_run_at = ? where id = ?")
        .run(JSON.stringify(result), now, test.id);
    }

    this.audit.record({
      orgId: input.orgId,
      entityType: "skill_revision",
      entityId: revision.id,
      actorType: "system",
      actorId: null,
      action: "tests_run",
      payload: { slug: revision.slug, version: revision.version_semver, total: tests.length, passed, failed },
    });
    return revision.id;
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
  skill_id: string;
  revision_id: string;
  version_semver: string;
  manifest_json: string;
  object_key: string;
}

interface SkillRevisionTestRow {
  id: string;
  version_semver: string;
  slug: string;
}
