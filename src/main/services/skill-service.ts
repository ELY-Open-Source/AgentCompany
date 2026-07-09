import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalize } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { BindSkillInput, ImportSkillDirectoryInput, ResolveAgentSkillsInput, RunSkillTestsInput } from "../../shared/commands";
import { SLO_SIGNAL_KEY } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { OperationsService } from "./operations-service";
import { copySkillRevision, recursiveSkillChecksum } from "./skill-artifacts";
import { loadSkillManifest, type SkillManifest } from "./skill-manifest";

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * House-style skills every agent carries on every run, CEO included. They are
 * a resolution rule, not a binding row, so no creation path — hire tool,
 * onboarding, tests, raw SQL — can produce an agent without them.
 */
export const FORCED_SKILL_SLUGS = ["humanizer"] as const;

/**
 * Compiled skill prompts stop packing past this size so one over-granted
 * agent cannot overflow the model's context window. Skills pack whole, forced
 * skills first, and anything omitted is named in the prompt.
 */
export const MAX_COMPILED_PROMPT_CHARS = 200_000;

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
   * catalogue mirrors the shipped bundle. Bindings pin revisions directly
   * and keep resolving; retired skills leave list_skills and cannot be
   * granted anew. Returns the retired slugs.
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
   * agent carries the forced house-style skills once the catalogue holds
   * them, plus whatever bindings the CEO granted.
   */
  hasRuntimeSkills(orgId: string, agentId: string): boolean {
    const forced = this.db.prepare(`
      select sd.id from skill_definitions sd
      join skill_revisions sr on sr.skill_id = sd.id
      where sd.org_id = ? and sd.status = 'active' and sd.slug in (${forcedSlugPlaceholders()})
      limit 1
    `).get(orgId, ...FORCED_SKILL_SLUGS);
    if (forced) return true;
    return Boolean(this.db.prepare(
      "select id from skill_bindings where org_id = ? and agent_id = ? and enabled = 1 limit 1",
    ).get(orgId, agentId));
  }

  /**
   * Freezes the exact skill set this run carries: forced house-style skills
   * first (identical for everyone, CEO included), then the agent's enabled
   * bindings in priority order, deduplicated per skill. Skills pack whole
   * until MAX_COMPILED_PROMPT_CHARS; whatever does not fit is named in the
   * compiled prompt instead of silently overflowing the model's context.
   */
  resolveRuntimeSnapshot(input: ResolveAgentSkillsInput): string {
    // Idempotent per run: a run interrupted after resolving (crash, quit) is
    // re-queued by startup recovery and must reuse its frozen skill set, not
    // die on a uniqueness error that burns real retry budget.
    const existingSnapshot = this.db.prepare("select id from skill_runtime_snapshots where agent_id = ? and run_id = ?")
      .get(input.agentId, input.runId) as { id: string } | undefined;
    if (existingSnapshot) return existingSnapshot.id;
    const forcedRows = this.db.prepare(`
      select
        sd.id as skill_id,
        sr.id as revision_id,
        sr.version_semver,
        sr.manifest_json,
        sa.object_key
      from skill_definitions sd
      join skill_revisions sr on sr.id = (
        select id from skill_revisions where skill_id = sd.id order by published_at desc, id desc limit 1
      )
      join skill_artifacts sa on sa.revision_id = sr.id and sa.artifact_type in ('entrypoint', 'markdown')
      where sd.org_id = ? and sd.status = 'active' and sd.slug in (${forcedSlugPlaceholders()})
      order by sd.slug asc
    `).all(input.orgId, ...FORCED_SKILL_SLUGS) as unknown as RuntimeSkillRow[];
    const boundRows = this.db.prepare(`
      select
        sb.skill_id as skill_id,
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
    const rows: RuntimeSkillRow[] = [];
    const seenSkillIds = new Set<string>();
    for (const row of [...forcedRows, ...boundRows]) {
      if (seenSkillIds.has(row.skill_id)) continue;
      seenSkillIds.add(row.skill_id);
      rows.push(row);
    }
    if (rows.length === 0) throw new Error("Agent has no enabled skills.");

    const compiledParts: string[] = [];
    const tools = new Set<string>();
    const revisionIds: string[] = [];
    const omitted: string[] = [];
    let compiledLength = 0;
    for (const row of rows) {
      if (!existsSync(row.object_key)) throw new Error(`Skill artifact is missing: ${row.object_key}`);
      const manifest = JSON.parse(row.manifest_json) as SkillManifest;
      const part = [
        `# Skill: ${manifest.name}`,
        `Version: ${row.version_semver}`,
        readFileSync(row.object_key, "utf8").trim(),
      ].join("\n\n");
      if (compiledParts.length > 0 && compiledLength + part.length > MAX_COMPILED_PROMPT_CHARS) {
        omitted.push(manifest.name);
        continue;
      }
      for (const tool of manifest.requiredTools) tools.add(tool);
      revisionIds.push(row.revision_id);
      compiledParts.push(part);
      compiledLength += part.length;
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

function forcedSlugPlaceholders(): string {
  return FORCED_SKILL_SLUGS.map(() => "?").join(", ");
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

interface SkillTestRow {
  id: string;
  test_type: string;
  expected_output_ref: string;
}

interface SkillArtifactRow {
  artifact_type: string;
  object_key: string;
  sha256: string;
  size_bytes: number;
}

interface SkillTestResult {
  status: "passed" | "failed";
  testType: string;
  expectedOutputRef: string;
  checks: Array<{ name: string; status: "passed" | "failed"; detail: string }>;
  artifactSha256?: string;
  failure?: string;
}

function verifyRevisionStructure(artifacts: SkillArtifactRow[]): SkillTestResult | null {
  const requiredTypes = ["manifest", "entrypoint"];
  for (const type of requiredTypes) {
    if (!artifacts.some((artifact) => artifact.artifact_type === type)) {
      return failedSkillTest("revision_structure", type, `Skill revision artifact is missing: ${type}`);
    }
  }
  for (const artifact of artifacts) {
    try {
      verifyArtifactIntegrity(artifact);
    } catch (error) {
      return failedSkillTest("artifact_integrity", artifact.object_key, error instanceof Error ? error.message : String(error));
    }
  }
  return null;
}

function runManifestArtifactTest(test: SkillTestRow, artifacts: SkillArtifactRow[]): SkillTestResult {
  if (test.test_type !== "manifest") {
    return failedSkillTest(test.test_type, test.expected_output_ref, `Unsupported skill test type: ${test.test_type}`);
  }
  const testArtifact = artifacts.find((artifact) => (
    artifact.artifact_type === "test" && artifactMatchesExpectedRef(artifact.object_key, test.expected_output_ref)
  ));
  if (!testArtifact) return failedSkillTest(test.test_type, test.expected_output_ref, "Skill test artifact was not found.");

  try {
    const content = verifyArtifactIntegrity(testArtifact).toString("utf8");
    if (!content.trim()) throw new Error("Skill test artifact is empty.");
    return {
      status: "passed",
      testType: test.test_type,
      expectedOutputRef: test.expected_output_ref,
      artifactSha256: testArtifact.sha256,
      checks: [
        { name: "manifest_test_artifact", status: "passed", detail: "Artifact exists, checksum matches, and content is non-empty." },
      ],
    };
  } catch (error) {
    return failedSkillTest(test.test_type, test.expected_output_ref, error instanceof Error ? error.message : String(error));
  }
}

function verifyArtifactIntegrity(artifact: SkillArtifactRow): Buffer {
  if (!existsSync(artifact.object_key)) throw new Error(`Skill artifact is missing: ${artifact.object_key}`);
  const body = readFileSync(artifact.object_key);
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (sha256 !== artifact.sha256) throw new Error(`Skill artifact checksum mismatch: ${artifact.object_key}`);
  if (body.byteLength !== artifact.size_bytes) throw new Error(`Skill artifact size mismatch: ${artifact.object_key}`);
  return body;
}

function artifactMatchesExpectedRef(objectKey: string, expectedRef: string): boolean {
  const expected = normalizeSkillPath(expectedRef);
  const actual = normalizeSkillPath(objectKey);
  return actual === expected || actual.endsWith(`/${expected}`);
}

function normalizeSkillPath(value: string): string {
  return normalize(value).replaceAll("\\", "/");
}

function failedSkillTest(testType: string, expectedOutputRef: string, failure: string): SkillTestResult {
  return {
    status: "failed",
    testType,
    expectedOutputRef,
    checks: [{ name: "skill_test", status: "failed", detail: failure }],
    failure,
  };
}
