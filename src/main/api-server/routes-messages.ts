import log from "electron-log/main.js";
import { agentMessageInputSchema } from "@shared/contracts";
import { dispatchAgentMessage } from "../message-dispatch";
import { requireParam, type AgentApiServer } from "./server-core";

export function registerMessageRoutes(server: AgentApiServer) {
  const db = server.db;
  const onDomainChanged = server.onDomainChanged;
  const onWakeAgent = server.onWakeAgent;
  const emitEvent = server.emitEvent;

  server.addRoute("POST", "/api/issues/:issueId/comments", (_req, res, params, token, body) => {
    const input = body as { body?: string } | null;
    if (!input?.body || typeof input.body !== "string") {
      server.json(res, 400, { error: "body is required" });
      return;
    }
    if (input.body.length > 4000) {
      server.json(res, 400, { error: "Comment body must not exceed 4000 characters" });
      return;
    }
    try {
      const task = db.getTask(requireParam(params, "issueId"));
      if (task.companyId !== token.companyId) {
        server.json(res, 404, { error: "Task not found" });
        return;
      }
      const agent = db.getAgent(token.agentId);
      const comment = db.addComment({
        companyId: task.companyId,
        taskId: task.id,
        authorAgentId: token.agentId,
        authorName: agent.name,
        body: input.body,
      });
      onDomainChanged();

      // Fire comment automation rules
      server.callbacks.onCommentPosted(task.id, task.companyId, token.agentId);

      const wokenForComment = new Set<string>();
      if (task.assigneeAgentId && task.assigneeAgentId !== token.agentId) {
        onWakeAgent(task.assigneeAgentId, task.companyId, "comment");
        wokenForComment.add(task.assigneeAgentId);
      }

      const chain = db.getChainOfCommand(token.agentId);
      if (chain.length > 0 && chain[0].id !== token.agentId && !wokenForComment.has(chain[0].id)) {
        onWakeAgent(chain[0].id, task.companyId, "comment");
        wokenForComment.add(chain[0].id);
      }

      // @mention detection: wake any mentioned agents not already woken
      const mentionedIds = db.findMentionedAgentIds(task.companyId, input.body);
      for (const mentionedId of mentionedIds) {
        if (mentionedId !== token.agentId && !wokenForComment.has(mentionedId)) {
          onWakeAgent(mentionedId, task.companyId, "comment_mentioned");
          wokenForComment.add(mentionedId);
        }
      }

      server.json(res, 201, comment);
    } catch (err) {
      log.warn(`[api/messages] addComment failed:`, err instanceof Error ? err.message : String(err));
      server.json(res, 404, { error: "Task not found" });
    }
  });

  server.addRoute("GET", "/api/issues/:issueId/comments", (_req, res, params, token) => {
    try {
      const task = db.getTask(requireParam(params, "issueId"));
      if (task.companyId !== token.companyId) {
        server.json(res, 404, { error: "Task not found" });
        return;
      }
    } catch (err) {
      log.warn(`[api/messages] getTask failed for comments list:`, err instanceof Error ? err.message : String(err));
      server.json(res, 404, { error: "Task not found" });
      return;
    }
    const comments = db.listComments(requireParam(params, "issueId"));
    server.json(res, 200, comments);
  });

  server.addRoute("POST", "/api/companies/:companyId/messages", (_req, res, params, token, body) => {
    const companyId = requireParam(params, "companyId");
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }

    const parsed = agentMessageInputSchema.safeParse({
      ...(body as Record<string, unknown>),
      companyId,
      fromAgentId: token.agentId,
    });
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() });
      return;
    }

    const dispatchResult = dispatchAgentMessage(
      {
        db,
        emitEvent,
        notify: server.callbacks.notify,
        publishDomainChanged: onDomainChanged,
        wakeAgentIfPossible: (agentId, cid, trigger) => {
          if (!agentId) return null;
          return onWakeAgent(agentId, cid, trigger);
        },
        onHumanMessage: server.callbacks.onHumanMessage,
      },
      parsed.data,
      "message",
    );
    if (!dispatchResult.ok) {
      server.json(res, 400, { error: dispatchResult.error.message, code: dispatchResult.error.code });
      return;
    }

    server.json(res, 201, { id: dispatchResult.data.id });
  });

  server.addRoute("GET", "/api/companies/:companyId/messages", (req, res, params, token) => {
    const companyId = requireParam(params, "companyId");
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${server.port}`);
    const channelParam = url.searchParams.get("channel");
    const channelTargetId = url.searchParams.get("channelTargetId");
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";
    const limitStr = url.searchParams.get("limit");
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200) : 50;
    const allowedChannels = new Set(["direct", "department", "company", "project", "incident"]);
    if (channelParam && !allowedChannels.has(channelParam)) {
      server.json(res, 400, { error: `Invalid channel filter: ${channelParam}` });
      return;
    }

    const messages = db.listAgentMessages(companyId, {
      agentId: token.agentId,
      channel: channelParam ?? undefined,
      channelTargetId: channelTargetId && channelTargetId.length > 0 ? channelTargetId : undefined,
      unreadOnly,
      limit,
    });
    server.json(res, 200, messages);
  });

  server.addRoute("POST", "/api/companies/:companyId/messages/:messageId/read", (_req, res, params, token) => {
    const companyId = requireParam(params, "companyId");
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const message = db.getAgentMessage(requireParam(params, "messageId"), companyId);
    if (!message) {
      server.json(res, 404, { error: "Message not found" });
      return;
    }
    const visibleToAgent = db.listAgentMessages(companyId, {
      agentId: token.agentId,
      messageId: message.id,
      limit: 1,
    }).some((entry) => entry.id === message.id);
    if (!visibleToAgent) {
      server.json(res, 403, { error: "This message is not visible to the current agent" });
      return;
    }
    db.markMessageReadForReader(requireParam(params, "messageId"), companyId, token.agentId);
    onDomainChanged();
    server.json(res, 200, { ok: true });
  });
}
