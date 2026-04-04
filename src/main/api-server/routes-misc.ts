import { z } from "zod";
import { validateTaskCreation } from "../task-quality-gates";
import type { AgentApiServer } from "./server-core";

const socialDraftSchema = z.object({
  socialAccountId: z.string().uuid(),
  platform: z.string(),
  content: z.string().min(1).max(10000),
  mediaUrls: z.array(z.string()).default([]),
  scheduledAt: z.string().datetime().optional(),
});

export function registerMiscRoutes(server: AgentApiServer) {
  const db = server.db_;
  const onDomainChanged = server.onDomainChanged_;
  const onWakeAgent = server.onWakeAgent_;

  server.addRoute("POST", "/api/companies/:companyId/browser/action", async (_req, res, params, token, body) => {
    const companyId = params.companyId!;
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }

    const actionSchema = z.object({
      socialAccountId: z.string().uuid(),
      actionType: z.enum(["post", "reply", "like", "follow", "browse_feed", "screenshot", "navigate", "search"]),
      payload: z.record(z.string(), z.unknown()).default({}),
    });

    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid browser action payload", details: parsed.error.issues });
      return;
    }

    const input = parsed.data;

    const snapshot = db.listSnapshot();
    const account = snapshot.socialAccounts.find(a => a.id === input.socialAccountId && a.companyId === companyId);
    if (!account) {
      server.json(res, 404, { error: "Social account not found" });
      return;
    }

    const postActions = ["post", "reply", "dm"];
    if (account.requireApproval && postActions.includes(input.actionType)) {
      const approvalId = db.requestApproval({
        companyId,
        type: "dangerous_command",
        relatedTaskId: null,
        requestedByAgentId: token.agentId,
        payloadSummary: `${input.actionType} on ${account.platform}/@${account.accountName}: ${String(input.payload.content || "").slice(0, 100)}`,
        impactSummary: `Will ${input.actionType} on ${account.displayName || account.accountName}'s ${account.platform} account. Content will be publicly visible.`,
      });

      const actionId = db.saveBrowserAction({
        companyId,
        socialAccountId: input.socialAccountId,
        agentId: token.agentId,
        actionType: input.actionType,
        payloadJson: JSON.stringify(input.payload),
        status: "approval_required",
        approvalId,
      });

      db.addActivity({
        companyId,
        actor: token.agentId,
        action: "browser.action_pending_approval",
        entityType: "browser_action",
        entityId: actionId,
        detail: `${input.actionType} on ${account.platform} requires approval`,
      });

      onDomainChanged();
      server.json(res, 202, { id: actionId, status: "approval_required", approvalId, message: "Action requires Board approval before execution" });
      return;
    }

    const actionId = db.saveBrowserAction({
      companyId,
      socialAccountId: input.socialAccountId,
      agentId: token.agentId,
      actionType: input.actionType,
      payloadJson: JSON.stringify(input.payload),
      status: "queued",
    });

    db.addActivity({
      companyId,
      actor: token.agentId,
      action: "browser.action_queued",
      entityType: "browser_action",
      entityId: actionId,
      detail: `${input.actionType} on ${account.platform}/@${account.accountName}`,
    });

    onDomainChanged();

    const onBrowserAction = server.onBrowserAction_;
    if (onBrowserAction) {
      onBrowserAction(actionId, companyId, input.socialAccountId, input.actionType, input.payload as Record<string, unknown>);
    }

    server.json(res, 201, { id: actionId, status: "queued", message: "Browser action queued for execution" });
  });

  server.addRoute("GET", "/api/companies/:companyId/social-accounts", (_req, res, params, token) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const accounts = db.listSocialAccounts(params.companyId!);
    const sanitized = accounts.map(a => ({
      id: a.id,
      platform: a.platform,
      accountName: a.accountName,
      displayName: a.displayName,
      profileUrl: a.profileUrl,
      status: a.status,
      requireApproval: a.requireApproval,
    }));
    server.json(res, 200, sanitized);
  });

  server.addRoute("POST", "/api/companies/:companyId/social/draft", async (_req, res, params, token, body) => {
    const companyId = params.companyId!;
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }

    const parsed = socialDraftSchema.safeParse(body);
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid draft", details: parsed.error.issues });
      return;
    }

    const account = db.getSocialAccount(parsed.data.socialAccountId, companyId);
    if (!account) {
      server.json(res, 404, { error: "Social account not found" });
      return;
    }

    const contentPreview = parsed.data.content.slice(0, 120) + (parsed.data.content.length > 120 ? "..." : "");

    const approvalId = db.requestApproval({
      companyId,
      requestedByAgentId: token.agentId,
      type: "social_post",
      payloadSummary: contentPreview,
      impactSummary: `Post to ${account.platform} via @${account.accountName}`,
      payloadJson: JSON.stringify({
        socialAccountId: parsed.data.socialAccountId,
        platform: account.platform,
        content: parsed.data.content,
        mediaUrls: parsed.data.mediaUrls,
        scheduledAt: parsed.data.scheduledAt ?? null,
      }),
    });

    onDomainChanged();
    server.json(res, 201, { approvalId, status: "pending_approval" });
  });

  server.addRoute("GET", "/api/companies/:companyId/browser/actions", (req, res, params, token) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${server.port_}`);
    const socialAccountId = url.searchParams.get("socialAccountId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const limit = Number(url.searchParams.get("limit") || 50);

    const actions = db.listBrowserActions(params.companyId!, { socialAccountId, status, limit });
    server.json(res, 200, actions);
  });

  server.addRoute("POST", "/api/companies/:companyId/meetings", (_req, res, params, token, body) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const data = body as Record<string, unknown>;
    const participantAgentIds = data.participantAgentIds ? String(data.participantAgentIds) : "[]";
    try {
      const parsedParticipants = JSON.parse(participantAgentIds) as string[];
      for (const agentId of parsedParticipants) {
        if (typeof agentId !== "string" || !db.belongsToCompany("agents", agentId, token.companyId)) {
          server.json(res, 400, { error: "Meeting participants must belong to the current company" });
          return;
        }
      }
    } catch {
      server.json(res, 400, { error: "participantAgentIds must be a JSON array of agent ids" });
      return;
    }
    const id = db.saveMeeting({
      companyId: token.companyId,
      type: String(data.type ?? "department_sync"),
      title: String(data.title ?? "Meeting"),
      organizerAgentId: token.agentId,
      participantAgentIds,
      scheduledAt: String(data.scheduledAt ?? new Date().toISOString()),
      durationMinutes: Number(data.durationMinutes ?? 30),
      agendaJson: data.agendaJson ? String(data.agendaJson) : "[]",
      status: "scheduled",
    });
    onDomainChanged();
    server.json(res, 201, { id });
  });

  server.addRoute("GET", "/api/companies/:companyId/meetings", (_req, res, params, token) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const snapshot = db.listSnapshot();
    const meetings = snapshot.meetings.filter(m => m.companyId === token.companyId);
    server.json(res, 200, meetings);
  });

  server.addRoute("PATCH", "/api/meetings/:meetingId", (_req, res, params, token, body) => {
    const snapshot = db.listSnapshot();
    const existing = snapshot.meetings.find(m => m.id === params.meetingId && m.companyId === token.companyId);
    if (!existing) {
      server.json(res, 404, { error: "Meeting not found" });
      return;
    }
    const data = body as Record<string, unknown>;
    let actionItems: Array<{ title?: string; assigneeAgentId?: string; description?: string }> = [];
    if (data.actionItemsJson) {
      try {
        actionItems = JSON.parse(String(data.actionItemsJson)) as Array<{ title?: string; assigneeAgentId?: string; description?: string }>;
      } catch {
        server.json(res, 400, { error: "actionItemsJson must be valid JSON" });
        return;
      }
      for (const item of actionItems) {
        if (item.assigneeAgentId && !db.belongsToCompany("agents", item.assigneeAgentId, token.companyId)) {
          server.json(res, 400, { error: "Meeting action item assignees must belong to the current company" });
          return;
        }
      }
    }
    db.saveMeeting({
      id: params.meetingId,
      companyId: token.companyId,
      type: data.type ? String(data.type) : "department_sync",
      title: data.title ? String(data.title) : "Meeting",
      notesJson: data.notesJson ? String(data.notesJson) : undefined,
      decisionsJson: data.decisionsJson ? String(data.decisionsJson) : undefined,
      actionItemsJson: data.actionItemsJson ? String(data.actionItemsJson) : undefined,
      status: data.status ? String(data.status) : undefined,
      scheduledAt: data.scheduledAt ? String(data.scheduledAt) : new Date().toISOString(),
    });
    onDomainChanged();
    // When action items are added, create tasks for them automatically
    if (actionItems.length > 0) {
      for (const item of actionItems) {
        if (item.title && typeof item.title === "string") {
          const meetingTaskValidation = validateTaskCreation(
            { title: item.title, description: item.description ?? `Action item from meeting: ${data.title ?? existing.title}` },
            false,
          );
          if (!meetingTaskValidation.valid) {
            // Log but skip invalid meeting action items rather than failing the whole request
            continue;
          }
          db.saveTask({
            companyId: token.companyId,
            title: item.title,
            description: item.description ?? `Action item from meeting: ${data.title ?? existing.title}`,
            assigneeAgentId: item.assigneeAgentId ?? null,
            status: item.assigneeAgentId ? "todo" : "backlog",
            priority: "medium",
          });
          if (item.assigneeAgentId) {
            onWakeAgent(item.assigneeAgentId, token.companyId, "assignment");
          }
        }
      }
    }
    server.json(res, 200, { updated: true });
  });

  server.addRoute("POST", "/api/companies/:companyId/knowledge", (_req, res, params, token, body) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const data = body as Record<string, unknown>;
    const id = db.saveKnowledgeEntry({
      companyId: token.companyId,
      category: String(data.category ?? "lesson_learned"),
      topic: String(data.topic ?? ""),
      content: String(data.content ?? ""),
      authorAgentId: token.agentId,
      importance: String(data.importance ?? "medium"),
      tagsJson: data.tagsJson ? String(data.tagsJson) : "[]",
      referencedEntityType: data.referencedEntityType ? String(data.referencedEntityType) : null,
      referencedEntityId: data.referencedEntityId ? String(data.referencedEntityId) : null,
      sourceRunId: token.runId ?? null,
    });
    onDomainChanged();
    server.json(res, 201, { id });
  });

  server.addRoute("GET", "/api/companies/:companyId/knowledge", (_req, res, params, token) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const snapshot = db.listSnapshot();
    const entries = snapshot.knowledgeBase.filter(k => k.companyId === token.companyId);
    server.json(res, 200, entries);
  });

  // ── Skill REST API endpoints ──────────────────────────────────────

  server.addRoute("GET", "/api/companies/:companyId/skills", (_req, res, params, token) => {
    const companyId = params.companyId!;
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const skills = db.listCompanySkills(companyId);
    server.json(res, 200, skills.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description,
      sourceType: s.sourceType,
      trustLevel: s.trustLevel,
      createdAt: s.createdAt,
    })));
  });

  server.addRoute("GET", "/api/skills/:skillId", (_req, res, params, token) => {
    const skill = db.getCompanySkill(token.companyId, params.skillId!);
    if (!skill) {
      server.json(res, 404, { error: "Skill not found" });
      return;
    }
    server.json(res, 200, skill);
  });
}
