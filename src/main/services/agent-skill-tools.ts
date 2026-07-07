import { requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { JsonRecord } from "./provider-http";
import { SkillService } from "./skill-service";

/** Company skill library visibility for any agent: what exists, who holds it. */
export function listSkillsTool(deps: AgentToolDeps, ctx: AgentToolContext): string {
  const skills = deps.db.prepare(
    "select id, name, slug from skill_definitions where org_id = ? and status = 'active' order by slug asc",
  ).all(ctx.orgId) as Array<{ id: string; name: string; slug: string }>;
  if (skills.length === 0) {
    return "The company has no skills yet. The board imports them on the Settings page.";
  }
  const bindings = deps.db.prepare(
    "select skill_id, agent_id from skill_bindings where org_id = ? and enabled = 1",
  ).all(ctx.orgId) as Array<{ skill_id: string; agent_id: string }>;
  const agentNames = new Map(
    (deps.db.prepare("select id, name from agents where org_id = ?").all(ctx.orgId) as Array<{ id: string; name: string }>)
      .map((row) => [row.id, row.name]),
  );
  const lines = skills.map((skill) => {
    const holders = bindings
      .filter((binding) => binding.skill_id === skill.id)
      .map((binding) => agentNames.get(binding.agent_id))
      .filter(Boolean);
    return `- ${skill.name} (${skill.slug}): ${holders.length > 0 ? `granted to ${holders.join(", ")}` : "no grants yet"}`;
  });
  return ["Company skills (the CEO carries all of them; teammates need a grant):", ...lines].join("\n");
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
      "select id from skill_revisions where skill_id = ? order by published_at desc, id desc limit 1",
    ).get(skill.id) as { id: string } | undefined;
    if (!revision) return `ERROR: The "${skillSlug}" skill has no published revision.`;
    skillService.bind({ orgId: ctx.orgId, agentId: target.id, skillId: skill.id, revisionId: revision.id });
    return `${target.name} now has the ${skill.name} skill; it joins their next run.`;
  }
  skillService.unbind({ orgId: ctx.orgId, agentId: target.id, skillId: skill.id });
  return `${target.name} no longer has the ${skill.name} skill.`;
}
