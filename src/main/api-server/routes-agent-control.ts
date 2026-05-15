import log from "electron-log/main.js";
import { z } from "zod";
import { canControlAgent } from "../agent-permissions";
import { requireParam, type AgentApiServer } from "./server-core";

export function registerAgentControlRoutes(server: AgentApiServer) {
  const db = server.db;
  const onDomainChanged = server.onDomainChanged;
  const onWakeAgent = server.onWakeAgent;

  server.addRoute("POST", "/api/agents/:agentId/wake", (_req, res, params, token, body) => {
    const targetAgentId = requireParam(params, "agentId");
    const targetAgent = (() => {
      try {
        return db.core.entity.getAgent(targetAgentId);
      } catch (err) {
        log.warn(`[api/agent-control] getAgent failed for ${targetAgentId}:`, err instanceof Error ? err.message : String(err));
        return null;
      }
    })();
    if (!targetAgent || targetAgent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }
    if (!canControlAgent(db, token.companyId, token.agentId, targetAgentId)) {
      server.json(res, 403, { error: "Current agent is not allowed to wake this agent" });
      return;
    }
    const wakeSchema = z.object({
      reason: z.string().min(1).max(200).default("peer_request"),
    });
    const parsed = wakeSchema.safeParse(body);
    const reason = parsed.success ? parsed.data.reason : "peer_request";
    const alreadyActive = db.core.runs.hasActiveRun({ companyId: token.companyId, agentId: targetAgentId });
    const runId = onWakeAgent(targetAgentId, token.companyId, reason);
    if (runId) {
      server.json(res, 200, { ok: true, runId, message: `Wake started for agent ${targetAgentId}` });
      return;
    }
    if (alreadyActive) {
      server.json(res, 202, {
        ok: true,
        queued: true,
        message: `Agent ${targetAgentId} is already running. Wake will be retried after the active run completes.`,
      });
      return;
    }
    server.json(res, 409, { ok: false, error: "Agent could not be woken right now" });
  });

  server.addRoute("PATCH", "/api/agents/:agentId/heartbeat", (_req, res, params, token) => {
    const targetAgentId = requireParam(params, "agentId");
    let targetAgent;
    try {
      targetAgent = db.core.entity.getAgent(targetAgentId);
    } catch (err) {
      log.warn(`[api/agent-control] getAgent failed for heartbeat ${targetAgentId}:`, err instanceof Error ? err.message : String(err));
      targetAgent = null;
    }
    if (!targetAgent || targetAgent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found or not in the same company" });
      return;
    }
    if (!canControlAgent(db, token.companyId, token.agentId, targetAgentId)) {
      server.json(res, 403, { error: "Current agent is not allowed to trigger heartbeat for this agent" });
      return;
    }
    const alreadyActive = db.core.runs.hasActiveRun({ companyId: token.companyId, agentId: targetAgentId });
    const runId = onWakeAgent(targetAgentId, token.companyId, "peer_request");
    if (runId) {
      server.json(res, 200, { ok: true, runId, message: `Heartbeat triggered for agent ${targetAgentId}` });
      return;
    }
    if (alreadyActive) {
      server.json(res, 202, {
        ok: true,
        queued: true,
        message: `Agent ${targetAgentId} is already running. Heartbeat will retry after the current run.`,
      });
      return;
    }
    server.json(res, 409, { ok: false, error: "Heartbeat could not be started for this agent" });
  });

  server.addRoute("GET", "/api/agents/:agentId/skills", (_req, res, params, token) => {
    const agentId = requireParam(params, "agentId");
    let agent;
    try {
      agent = db.core.entity.getAgent(agentId);
    } catch (error) {
      log.warn(`[api/agent-skills:GET] getAgent(${agentId}) failed: ${error instanceof Error ? error.message : String(error)}`);
      agent = null;
    }
    if (!agent || agent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found in your company" });
      return;
    }
    const skillIds = db.core.skills.listAgentSkillAssignments(token.companyId, agentId);
    const skills = skillIds
      .map((sid) => db.core.skills.getCompanySkill(token.companyId, sid))
      .filter((s): s is NonNullable<typeof s> => s != null);
    server.json(res, 200, skills.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description,
      sourceType: s.sourceType,
      trustLevel: s.trustLevel,
    })));
  });

  server.addRoute("POST", "/api/agents/:agentId/skills", (_req, res, params, token, body) => {
    const agentId = requireParam(params, "agentId");
    const parsed = z.object({ skillId: z.string().uuid() }).safeParse(body);
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid body: skillId (uuid) required" });
      return;
    }
    let agent;
    try {
      agent = db.core.entity.getAgent(agentId);
    } catch (error) {
      log.warn(`[api/agent-skills:POST] getAgent(${agentId}) failed: ${error instanceof Error ? error.message : String(error)}`);
      agent = null;
    }
    if (!agent || agent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found in your company" });
      return;
    }
    const skill = db.core.skills.getCompanySkill(token.companyId, parsed.data.skillId);
    if (!skill) {
      server.json(res, 404, { error: "Skill not found in your company" });
      return;
    }
    if (!db.core.skills.assignSkillToAgent(token.companyId, agentId, parsed.data.skillId)) {
      server.json(res, 404, { error: "Skill assignment targets not found in your company" });
      return;
    }
    onDomainChanged();
    server.json(res, 200, { ok: true, message: `Skill "${skill.name}" assigned to agent ${agent.name}` });
  });

  server.addRoute("DELETE", "/api/agents/:agentId/skills/:skillId", (_req, res, params, token) => {
    const agentId = requireParam(params, "agentId");
    const skillId = requireParam(params, "skillId");
    let agent;
    try {
      agent = db.core.entity.getAgent(agentId);
    } catch (error) {
      log.warn(`[api/agent-skills:DELETE] getAgent(${agentId}) failed: ${error instanceof Error ? error.message : String(error)}`);
      agent = null;
    }
    if (!agent || agent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found in your company" });
      return;
    }
    const skill = db.core.skills.getCompanySkill(token.companyId, skillId);
    if (!skill) {
      server.json(res, 404, { error: "Skill not found in your company" });
      return;
    }
    if (!db.core.skills.removeSkillFromAgent(token.companyId, agentId, skillId)) {
      server.json(res, 404, { error: "Skill assignment not found in your company" });
      return;
    }
    onDomainChanged();
    server.json(res, 200, { ok: true, message: `Skill removed from agent ${agent.name}` });
  });
}
