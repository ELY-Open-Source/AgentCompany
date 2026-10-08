import { requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { JsonRecord } from "./provider-http";
import type { SkillManifest } from "./skill-manifest";
import { FORCED_SKILL_SLUGS, SkillService } from "./skill-service";

/** Company skill library visibility for any agent: what exists, who holds it. */
export function listSkillsTool(deps: AgentToolDeps, ctx: AgentToolContext): string {
  const skills = deps.db.prepare(`
    select sd.id, sd.name, sd.slug, sr.manifest_json
    from skill_definitions sd
    left join skill_revisions sr on sr.id = (
      select id from skill_revisions where skill_id = sd.id order by published_at desc, rowid desc limit 1
    )
    where sd.org_id = ? and sd.status = 'active'
    order by sd.slug asc
  `).all(ctx.orgId) as Array<{ id: string; name: string; slug: string; manifest_json: string | null }>;
  if (skills.length === 0) {
    return "The company skill library is empty. Built-in skills load at startup; if this persists, the installation is broken.";
  }
  const bindings = deps.db.prepare(
    "select skill_id, agent_id from skill_bindings where org_id = ? and enabled = 1",
  ).all(ctx.orgId) as Array<{ skill_id: string; agent_id: string }>;
  const agentNames = new Map(
    (deps.db.prepare("select id, name from agents where org_id = ?").all(ctx.orgId) as Array<{ id: string; name: string }>)
      .map((row) => [row.id, row.name]),
  );
  const forced = new Set<string>(FORCED_SKILL_SLUGS);
  const lines = skills.map((skill) => {
    const summary = skillSummary(skill.manifest_json);
    if (forced.has(skill.slug)) {
      const language = skill.slug === "humanizer-zh" ? "Chinese" : "English";
      return `- ${skill.name} (${skill.slug})${summary}: house style — carried automatically by every agent when the app language is ${language}`;
    }
    const holders = bindings
      .filter((binding) => binding.skill_id === skill.id)
      .map((binding) => agentNames.get(binding.agent_id))
      .filter(Boolean);
    return `- ${skill.name} (${skill.slug})${summary}: ${holders.length > 0 ? `granted to ${holders.join(", ")}` : "no grants yet"}`;
  });
  return [
    "Company skill library (grant by slug with grant_skill, or pass skills to hire_agent):",
    ...lines,
  ].join("\n");
}

/** CEO-only: hand a skill to a teammate, or take it back. */
export function grantSkillTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord, mode: "grant" | "revoke"): string {
  const acting = deps.db.prepare("select role_level from agents where id = ? and org_id = ?")
    .get(ctx.agent.id, ctx.orgId) as { role_level: string } | undefined;
  if (acting?.role_level !== "c_suite") {
    return "ERROR: Only the CEO can manage skill grants. Ask them to run this.";
  }
  const agentName = requireString(args.agent_name, "agent_name");
  const skillSlug = requireString(args.skill, "skill").trim().toLowerCase();
  if ((FORCED_SKILL_SLUGS as readonly string[]).includes(skillSlug)) {
    return mode === "grant"
      ? `${agentName} already carries ${skillSlug} automatically — it is company house style for every agent.`
      : `ERROR: ${skillSlug} is company house style and cannot be revoked from anyone.`;
  }
  const target = deps.db.prepare(
    "select id, name from agents where org_id = ? and lower(name) = lower(?) and lifecycle = 'active' limit 1",
  ).get(ctx.orgId, agentName) as { id: string; name: string } | undefined;
  if (!target) return `ERROR: No active agent named "${agentName}".`;
  const skill = deps.db.prepare(
    "select id, name from skill_definitions where org_id = ? and slug = ? and status = 'active' limit 1",
  ).get(ctx.orgId, skillSlug) as { id: string; name: string } | undefined;
  if (!skill) return `ERROR: No skill "${skillSlug}" exists. Run list_skills to see the library.`;
  const skillService = new SkillService(deps.db, "");
  if (mode === "grant") {
    const revision = deps.db.prepare(
      "select id from skill_revisions where skill_id = ? order by published_at desc, rowid desc limit 1",
    ).get(skill.id) as { id: string } | undefined;
    if (!revision) return `ERROR: The "${skillSlug}" skill has no published revision.`;
    skillService.bind({ orgId: ctx.orgId, agentId: target.id, skillId: skill.id, revisionId: revision.id });
    return `${target.name} now has the ${skill.name} skill; it joins their next run.`;
  }
  skillService.unbind({ orgId: ctx.orgId, agentId: target.id, skillId: skill.id });
  return `${target.name} no longer has the ${skill.name} skill.`;
}

/**
 * Binds a set of library skills to a freshly hired agent. Unknown slugs are
 * reported back to the caller (the hiring CEO) instead of failing the hire.
 */
export function bindSkillSlugs(deps: AgentToolDeps, orgId: string, agentId: string, slugs: string[]): { granted: string[]; unknown: string[] } {
  const skillService = new SkillService(deps.db, "");
  const granted: string[] = [];
  const unknown: string[] = [];
  for (const raw of slugs) {
    const slug = raw.trim().toLowerCase();
    if (!slug || (FORCED_SKILL_SLUGS as readonly string[]).includes(slug)) continue;
    const row = deps.db.prepare(`
      select sd.id as skill_id, sd.name, sr.id as revision_id
      from skill_definitions sd
      join skill_revisions sr on sr.id = (
        select id from skill_revisions where skill_id = sd.id order by published_at desc, rowid desc limit 1
      )
      where sd.org_id = ? and sd.slug = ? and sd.status = 'active'
    `).get(orgId, slug) as { skill_id: string; name: string; revision_id: string } | undefined;
    if (!row) {
      unknown.push(slug);
      continue;
    }
    skillService.bind({ orgId, agentId, skillId: row.skill_id, revisionId: row.revision_id });
    granted.push(slug);
  }
  return { granted, unknown };
}

function skillSummary(manifestJson: string | null): string {
  if (!manifestJson) return "";
  try {
    const manifest = JSON.parse(manifestJson) as SkillManifest;
    if (!manifest.description) return "";
    const compact = manifest.description.replace(/\s+/g, " ").trim();
    return compact ? ` — ${compact.length > 140 ? `${compact.slice(0, 137)}...` : compact}` : "";
  } catch {
    return "";
  }
}
