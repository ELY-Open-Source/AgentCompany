import { z } from "zod";
import { goalInputSchema, projectInputSchema } from "@shared/contracts";
import { canManageGoal, canManageProject } from "../agent-permissions";
import type { AgentApiServer } from "./server-core";

export function registerWorkGraphRoutes(server: AgentApiServer) {
  const db = server.db_;
  const onDomainChanged = server.onDomainChanged_;
  const onWakeAgent = server.onWakeAgent_;

  server.addRoute("POST", "/api/companies/:companyId/projects", (_req, res, params, token, body) => {
    const companyId = params.companyId!;
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const parsed = projectInputSchema.safeParse({
      companyId,
      ...(typeof body === "object" && body ? body : {}),
    });
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid project payload" });
      return;
    }
    const input = parsed.data;
    if (server.companyRefError(res, companyId, [
      { id: input.goalId, table: "goals", label: "goal" },
      { id: input.leadAgentId, table: "agents", label: "lead agent" },
    ])) {
      return;
    }
    if (!canManageProject(db, companyId, token.agentId, input.leadAgentId ?? null)) {
      server.json(res, 403, { error: "Current agent is not allowed to create or assign this project" });
      return;
    }

    const id = db.saveProject({
      companyId,
      name: input.name,
      description: input.description ?? "",
      goalId: input.goalId ?? null,
      leadAgentId: input.leadAgentId ?? null,
      status: (input.status as "planned") ?? "planned",
      targetDate: input.targetDate ?? null,
    });

    db.addActivity({
      companyId,
      actor: token.agentId,
      action: "project.created",
      entityType: "project",
      entityId: id,
      detail: input.name,
    });

    onDomainChanged();
    if (input.leadAgentId && input.leadAgentId !== token.agentId) {
      onWakeAgent(input.leadAgentId, companyId, "assignment");
    }
    server.json(res, 201, { id });
  });

  server.addRoute("PATCH", "/api/projects/:projectId", (_req, res, params, token, body) => {
    const projectId = params.projectId!;

    const updateSchema = z.object({
      name: z.string().min(2).max(120).optional(),
      description: z.string().max(2000).optional(),
      status: z.enum(["planned", "active", "completed", "cancelled"]).optional(),
      leadAgentId: z.string().uuid().optional(),
      goalId: z.string().uuid().nullable().optional(),
      targetDate: z.string().nullable().optional(),
    });

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() });
      return;
    }

    const snapshot = db.listSnapshot();
    const existing = snapshot.projects.find(p => p.id === projectId && p.companyId === token.companyId);
    if (!existing) {
      server.json(res, 404, { error: "Project not found" });
      return;
    }
    const nextLeadAgentId = parsed.data.leadAgentId ?? existing.leadAgentId ?? null;
    if (!canManageProject(db, token.companyId, token.agentId, nextLeadAgentId)) {
      server.json(res, 403, { error: "Current agent is not allowed to update this project" });
      return;
    }

    try {
      db.saveProject({
        id: projectId,
        companyId: token.companyId,
        name: parsed.data.name ?? existing.name,
        description: parsed.data.description ?? existing.description,
        status: parsed.data.status ?? existing.status,
        leadAgentId: nextLeadAgentId,
        goalId: parsed.data.goalId !== undefined ? parsed.data.goalId : (existing.goalId ?? null),
        targetDate: parsed.data.targetDate !== undefined ? parsed.data.targetDate : (existing.targetDate ?? null),
      });
      onDomainChanged();
      server.json(res, 200, { ok: true });
    } catch {
      server.json(res, 500, { error: "Failed to update project" });
    }
  });

  server.addRoute("POST", "/api/companies/:companyId/goals", (_req, res, params, token, body) => {
    const companyId = params.companyId!;
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const parsed = goalInputSchema.safeParse({
      companyId,
      ...(typeof body === "object" && body ? body : {}),
    });
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid goal payload" });
      return;
    }
    const input = parsed.data;
    if (server.companyRefError(res, companyId, [
      { id: input.parentId, table: "goals", label: "parent goal" },
      { id: input.ownerAgentId, table: "agents", label: "owner agent" },
    ])) {
      return;
    }
    if (!canManageGoal(db, companyId, token.agentId, input.ownerAgentId ?? null)) {
      server.json(res, 403, { error: "Current agent is not allowed to create this goal" });
      return;
    }

    const id = db.saveGoal(input);
    db.addActivity({
      companyId,
      actor: token.agentId,
      action: "goal.created",
      entityType: "goal",
      entityId: id,
      detail: input.title,
    });
    onDomainChanged();
    if (input.ownerAgentId && input.ownerAgentId !== token.agentId && input.status === "active") {
      onWakeAgent(input.ownerAgentId, companyId, "goal_activated");
    }
    server.json(res, 201, { id });
  });

  server.addRoute("PATCH", "/api/goals/:goalId", (_req, res, params, token, body) => {
    const goalId = params.goalId!;

    const updateSchema = z.object({
      title: z.string().min(2).max(120).optional(),
      description: z.string().max(2000).optional(),
      status: z.enum(["planned", "active", "achieved", "cancelled"]).optional(),
      ownerAgentId: z.string().uuid().optional(),
    });

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() });
      return;
    }

    const snapshot = db.listSnapshot();
    const existing = snapshot.goals.find(g => g.id === goalId && g.companyId === token.companyId);
    if (!existing) {
      server.json(res, 404, { error: "Goal not found" });
      return;
    }
    const nextOwnerAgentId = parsed.data.ownerAgentId ?? existing.ownerAgentId ?? null;
    if (!canManageGoal(db, token.companyId, token.agentId, nextOwnerAgentId)) {
      server.json(res, 403, { error: "Current agent is not allowed to update this goal" });
      return;
    }

    try {
      db.saveGoal({
        id: goalId,
        companyId: token.companyId,
        title: parsed.data.title ?? existing.title,
        description: parsed.data.description ?? existing.description,
        status: parsed.data.status ?? existing.status,
        ownerAgentId: nextOwnerAgentId,
      });
      onDomainChanged();
      server.json(res, 200, { ok: true });
    } catch {
      server.json(res, 500, { error: "Failed to update goal" });
    }
  });

  server.addRoute("GET", "/api/companies/:companyId/goals", (_req, res, params, token) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const snapshot = db.listSnapshot();
    const goals = snapshot.goals.filter((g) => g.companyId === params.companyId);
    server.json(res, 200, goals);
  });

  server.addRoute("GET", "/api/companies/:companyId/projects", (_req, res, params, token) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const snapshot = db.listSnapshot();
    const projects = snapshot.projects.filter((p) => p.companyId === params.companyId);
    server.json(res, 200, projects);
  });

  server.addRoute("GET", "/api/companies/:companyId/sprints", (_req, res, params, token) => {
    const companyId = params.companyId!;
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const snapshot = db.listSnapshot();
    const sprints = snapshot.sprints.filter(s => s.companyId === companyId);
    server.json(res, 200, sprints);
  });

  server.addRoute("POST", "/api/companies/:companyId/sprints", (_req, res, params, token, body) => {
    const companyId = params.companyId!;
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const data = body as Record<string, unknown>;
    try {
      const id = db.saveSprint({
        companyId,
        name: String(data.name ?? "Sprint"),
        goal: String(data.goal ?? ""),
        startDate: String(data.startDate ?? new Date().toISOString()),
        endDate: String(data.endDate ?? new Date(Date.now() + 14 * 86400000).toISOString()),
        status: String(data.status ?? "planning") as "planning" | "active" | "review" | "completed" | "cancelled",
        retrospectiveNotes: String(data.retrospectiveNotes ?? ""),
        velocityPoints: Number(data.velocityPoints ?? 0),
        completedPoints: Number(data.completedPoints ?? 0),
      });
      onDomainChanged();
      server.json(res, 201, { id });
    } catch {
      server.json(res, 400, { error: "Invalid sprint data" });
    }
  });

  server.addRoute("GET", "/api/companies/:companyId/dashboard", (_req, res, params, token) => {
    const companyId = params.companyId!;
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const snapshot = db.listSnapshot();
    const agents = snapshot.agents.filter((a) => a.companyId === companyId);
    const tasks = snapshot.tasks.filter((t) => t.companyId === companyId);
    const recentActivity = snapshot.activity
      .filter((a) => a.companyId === companyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);

    const tasksByStatus: Record<string, number> = {};
    for (const t of tasks) {
      tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1;
    }

    server.json(res, 200, {
      totalAgents: agents.length,
      activeAgents: agents.filter((a) => a.status === "active" || a.status === "running").length,
      totalTasks: tasks.length,
      tasksByStatus,
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        actor: a.actor,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        detail: a.detail,
        createdAt: a.createdAt,
      })),
    });
  });
}
