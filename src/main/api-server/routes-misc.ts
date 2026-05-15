import { z } from "zod";
import { requireParam, type AgentApiServer } from "./server-core";
import { SocialAccountScopeError } from "../database/social";

const socialDraftSchema = z.object({
  socialAccountId: z.string().uuid(),
  platform: z.string(),
  content: z.string().min(1).max(10000),
  mediaUrls: z.array(z.string()).default([]),
  scheduledAt: z.string().datetime().optional(),
});

function writeSocialScopeError(
  server: AgentApiServer,
  res: Parameters<AgentApiServer["json"]>[0],
  error: unknown,
): boolean {
  if (error instanceof SocialAccountScopeError) {
    server.json(res, 422, { error: error.message, reference: error.reference });
    return true;
  }
  return false;
}

export function registerMiscRoutes(server: AgentApiServer) {
  const db = server.db;
  const onDomainChanged = server.onDomainChanged;

  server.addRoute("POST", "/api/companies/:companyId/browser/action", async (_req, res, params, token, body) => {
    const companyId = requireParam(params, "companyId");
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

    const account = db.core.social.getSocialAccount(input.socialAccountId, companyId);
    if (!account) {
      server.json(res, 404, { error: "Social account not found" });
      return;
    }

    const postActions = ["post", "reply", "dm"];
    if (account.requireApproval && postActions.includes(input.actionType)) {
      const approvalId = db.core.approvals.requestApproval({
        companyId,
        type: "dangerous_command",
        relatedTaskId: null,
        requestedByAgentId: token.agentId,
        payloadSummary: `${input.actionType} on ${account.platform}/@${account.accountName}: ${String(input.payload.content || "").slice(0, 100)}`,
        impactSummary: `Will ${input.actionType} on ${account.displayName || account.accountName}'s ${account.platform} account. Content will be publicly visible.`,
      });

      let actionId: string;
      try {
        actionId = db.core.social.saveBrowserAction({
          companyId,
          socialAccountId: input.socialAccountId,
          agentId: token.agentId,
          actionType: input.actionType,
          payloadJson: JSON.stringify(input.payload),
          status: "approval_required",
          approvalId,
        });
      } catch (error) {
        if (writeSocialScopeError(server, res, error)) return;
        throw error;
      }

      db.core.activity.addActivity({
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

    let actionId: string;
    try {
      actionId = db.core.social.saveBrowserAction({
        companyId,
        socialAccountId: input.socialAccountId,
        agentId: token.agentId,
        actionType: input.actionType,
        payloadJson: JSON.stringify(input.payload),
        status: "queued",
      });
    } catch (error) {
      if (writeSocialScopeError(server, res, error)) return;
      throw error;
    }

    db.core.activity.addActivity({
      companyId,
      actor: token.agentId,
      action: "browser.action_queued",
      entityType: "browser_action",
      entityId: actionId,
      detail: `${input.actionType} on ${account.platform}/@${account.accountName}`,
    });

    onDomainChanged();

    const onBrowserAction = server.onBrowserAction;
    if (onBrowserAction) {
      try {
        onBrowserAction(actionId, companyId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        db.core.social.updateBrowserAction(actionId, {
          status: "failed",
          resultSummary: "Browser action dispatch failed before execution completed.",
          errorMessage: message,
          finishedAt: new Date().toISOString(),
        });
        db.core.activity.addActivity({
          companyId,
          actor: token.agentId,
          action: "browser.action_dispatch_failed",
          entityType: "browser_action",
          entityId: actionId,
          detail: message,
        });
        onDomainChanged();
        server.json(res, 500, { id: actionId, status: "failed", error: "Browser action dispatch failed" });
        return;
      }
    }

    server.json(res, 201, { id: actionId, status: "queued", message: "Browser action queued for execution" });
  });

  server.addRoute("GET", "/api/companies/:companyId/social-accounts", (_req, res, params, token) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const accounts = db.core.social.listSocialAccounts(requireParam(params, "companyId"));
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
    const companyId = requireParam(params, "companyId");
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }

    const parsed = socialDraftSchema.safeParse(body);
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid draft", details: parsed.error.issues });
      return;
    }

    const account = db.core.social.getSocialAccount(parsed.data.socialAccountId, companyId);
    if (!account) {
      server.json(res, 404, { error: "Social account not found" });
      return;
    }

    const contentPreview = parsed.data.content.slice(0, 120) + (parsed.data.content.length > 120 ? "..." : "");

    const approvalId = db.core.approvals.requestApproval({
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
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${server.port}`);
    const socialAccountId = url.searchParams.get("socialAccountId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const limit = Number(url.searchParams.get("limit") || 50);

    const actions = db.core.social.listBrowserActions(requireParam(params, "companyId"), { socialAccountId, status, limit });
    server.json(res, 200, actions);
  });

  server.addRoute("POST", "/api/companies/:companyId/knowledge", (_req, res, params, token, body) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }

    const knowledgeCreateSchema = z.object({
      category: z.string().default("lesson_learned"),
      topic: z.string().default(""),
      content: z.string().default(""),
      importance: z.string().default("medium"),
      tagsJson: z.string().default("[]"),
      referencedEntityType: z.string().nullable().optional(),
      referencedEntityId: z.string().nullable().optional(),
    });

    const parsed = knowledgeCreateSchema.safeParse(body);
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid knowledge entry payload", details: parsed.error.issues });
      return;
    }

    const input = parsed.data;
    const id = db.core.knowledge.saveKnowledgeEntry({
      companyId: token.companyId,
      category: input.category,
      topic: input.topic,
      content: input.content,
      authorAgentId: token.agentId,
      importance: input.importance,
      tagsJson: input.tagsJson,
      referencedEntityType: input.referencedEntityType ?? null,
      referencedEntityId: input.referencedEntityId ?? null,
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
    const entries = db.core.knowledge.listKnowledgeEntries(token.companyId);
    server.json(res, 200, entries);
  });

  // ── Skill REST API endpoints ──────────────────────────────────────

  server.addRoute("GET", "/api/companies/:companyId/skills", (_req, res, params, token) => {
    const companyId = requireParam(params, "companyId");
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const skills = db.core.skills.listCompanySkills(companyId);
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
    const skill = db.core.skills.getCompanySkill(token.companyId, requireParam(params, "skillId"));
    if (!skill) {
      server.json(res, 404, { error: "Skill not found" });
      return;
    }
    server.json(res, 200, skill);
  });
}
