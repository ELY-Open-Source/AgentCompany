import { z } from "zod";
import { taskInputSchema } from "@shared/contracts";
import { IMPORTANT_DOC_TYPES } from "@shared/document-categories";
import { canAssignTask, canUpdateTask } from "../agent-permissions";
import { inferTaskType } from "../connector-matching";
import { validateTaskCreation } from "../task-quality-gates";
import { requireParam, type AgentApiServer } from "./server-core";

type TaskListRow = {
  id: string; companyId: string; projectId: string | null; goalId: string | null;
  parentId: string | null; title: string; description: string;
  assigneeAgentId: string | null; workspaceId: string | null; status: string;
  priority: string; activeRunId: string | null; sessionJson: string | null;
  sessionDisplayId: string | null; costUsd: number | null;
  requiresUserReview: number; startedAt: string | null;
  completedAt: string | null; cancelledAt: string | null;
  createdAt: string; updatedAt: string;
};

const taskUpdateSchema = z.object({
  status: z.enum(["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"]).optional(),
  comment: z.string().min(1).max(4000).optional(),
  title: z.string().min(2).max(160).optional(),
  description: z.string().max(4000).optional(),
  assigneeAgentId: z.string().uuid().nullable().optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
});

const checkoutSchema = z.object({
  agentId: z.string().uuid().optional(),
});

export function registerTaskRoutes(server: AgentApiServer) {
  const db = server.db;
  const callbacks = server.callbacks;
  const onDomainChanged = server.onDomainChanged;
  const onWakeAgent = server.onWakeAgent;

  server.addRoute("GET", "/api/companies/:companyId/issues", (req, res, params, token) => {
    const companyId = requireParam(params, "companyId");
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${server.port}`);
    const assigneeAgentId = url.searchParams.get("assigneeAgentId");
    const statusFilter = url.searchParams.get("status");
    const statuses = statusFilter ? statusFilter.split(",") : ["todo", "in_progress", "blocked"];

    if (assigneeAgentId) {
      const tasks = db.listAgentTasks(assigneeAgentId, companyId, statuses);
      server.json(res, 200, tasks);
    } else {
      const placeholders = statuses.map(() => "?").join(", ");
      const tasks = db.queryAll<TaskListRow>(
        `select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, active_run_id as activeRunId, session_json as sessionJson, session_display_id as sessionDisplayId, cost_usd as costUsd, requires_user_review as requiresUserReview, started_at as startedAt, completed_at as completedAt, cancelled_at as cancelledAt, created_at as createdAt, updated_at as updatedAt from tasks where company_id = ? and status in (${placeholders}) order by created_at desc`,
        companyId, ...statuses,
      ).map((t) => ({ ...t, requiresUserReview: Boolean(t.requiresUserReview), startedAt: t.startedAt ?? null, completedAt: t.completedAt ?? null, cancelledAt: t.cancelledAt ?? null }));
      server.json(res, 200, tasks);
    }
  });

  server.addRoute("GET", "/api/issues/:issueId", (_req, res, params, token) => {
    try {
      const task = db.getTask(requireParam(params, "issueId"));
      if (task.companyId !== token.companyId) {
        server.json(res, 404, { error: "Task not found" });
        return;
      }
      server.json(res, 200, task);
    } catch {
      server.json(res, 404, { error: "Task not found" });
    }
  });

  server.addRoute("POST", "/api/issues/:issueId/checkout", (_req, res, params, token, body) => {
    const parsedBody = checkoutSchema.safeParse(body);
    if (!parsedBody.success) {
      server.json(res, 400, { error: "Invalid checkout payload" });
      return;
    }
    const agentId = parsedBody.data.agentId ?? token.agentId;
    if (agentId !== token.agentId) {
      server.json(res, 403, { error: "Agents can only checkout work for themselves" });
      return;
    }
    let task;
    try {
      task = db.getTask(requireParam(params, "issueId"));
    } catch {
      server.json(res, 404, { error: "Task not found" });
      return;
    }
    if (task.companyId !== token.companyId) {
      server.json(res, 404, { error: "Task not found" });
      return;
    }
    if (task.assigneeAgentId && !canUpdateTask(db, token.companyId, token.agentId, task)) {
      server.json(res, 403, { error: "Current agent is not allowed to checkout this task" });
      return;
    }
    const previousStatus = task.status;
    const success = db.checkoutTask(task.id, token.runId);
    if (!success) {
      server.json(res, 409, { error: "Task cannot be checked out — already assigned or not in valid status" });
      return;
    }
    onDomainChanged();
    // Checkout changes status from todo/backlog to in_progress — use actual previous status
    callbacks.onTaskStatusChanged(task.id, task.companyId, previousStatus, "in_progress");
    server.json(res, 200, { ok: true });
  });

  server.addRoute("PATCH", "/api/issues/:issueId", (_req, res, params, token, body) => {
    const parsedUpdate = taskUpdateSchema.safeParse(body);
    if (!parsedUpdate.success) {
      server.json(res, 400, { error: "Invalid task update payload" });
      return;
    }
    const update = parsedUpdate.data;

    try {
      const task = db.getTask(requireParam(params, "issueId"));
      if (task.companyId !== token.companyId) {
        server.json(res, 404, { error: "Task not found" });
        return;
      }
      if (!canUpdateTask(db, token.companyId, token.agentId, task)) {
        server.json(res, 403, { error: "Current agent is not allowed to update this task" });
        return;
      }

      const newAssignee = update.assigneeAgentId !== undefined ? update.assigneeAgentId : task.assigneeAgentId;
      if (!canAssignTask(db, token.companyId, token.agentId, newAssignee ?? null)) {
        server.json(res, 403, { error: "Current agent is not allowed to assign this task to the selected agent" });
        return;
      }

      // Deliverable review gate: intercept agent trying to advance a flagged task to "done".
      // This MUST succeed — silently skipping review would let unreviewed work advance.
      if (update.status === "done" && task.requiresUserReview) {
        const importantTypes = IMPORTANT_DOC_TYPES;
        const placeholders = importantTypes.map(() => "?").join(", ");
        const docs = db.queryAll<{ id: string; type: string; title: string }>(
          `select id, type, title from documents where company_id = ? and type in (${placeholders})
           and (author_agent_id = ? or created_at >= (select created_at from tasks where id = ?))
           order by created_at desc limit 10`,
          task.companyId, ...importantTypes, task.assigneeAgentId ?? "", task.id,
        );
        const reviewerAgent = db.getAgent(token.agentId);
        const docTitles = docs.map((d) => d.title).join(", ");
        db.requestApproval({
          companyId: task.companyId,
          relatedTaskId: task.id,
          requestedByAgentId: token.agentId,
          type: "deliverable_review",
          payloadSummary: `Review deliverable: ${docTitles || task.title}`.slice(0, 280),
          impactSummary: `${reviewerAgent.name} reviewed and approved. Awaiting your final review.`.slice(0, 400),
          payloadJson: JSON.stringify({ documentIds: docs.map((d) => d.id), documents: docs }),
        });
        db.setTaskRequiresUserReview(task.id, false);
        if (task.assigneeAgentId) {
          const prodAgent = db.getAgent(task.assigneeAgentId);
          if (prodAgent.heartbeatEnabled) {
            db.setHeartbeat(task.assigneeAgentId, false, prodAgent.heartbeatIntervalSec || 120);
          }
        }
        db.addComment({ companyId: task.companyId, taskId: task.id, authorAgentId: null, authorName: "System", body: "Deliverable submitted for board review." });
        update.status = "in_review";
      }

      // Validate status transition
      const effectiveStatus = update.status ?? task.status;
      const VALID_STATUSES = new Set(["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"]);
      if (update.status && !VALID_STATUSES.has(update.status)) {
        server.json(res, 400, { error: `Invalid task status: ${update.status}` });
        return;
      }

      // Apply status side-effect timestamps FIRST via advanceTaskStatus
      // so started_at / completed_at / cancelled_at are set correctly.
      // advanceTaskStatus checks previousStatus !== newStatus internally,
      // so it must run before saveTask writes the new status.
      if (update.status && update.status !== task.status) {
        db.advanceTaskStatus(task.id, update.status);
      }

      const input: Record<string, unknown> = {
        id: task.id,
        companyId: task.companyId,
        title: update.title ?? task.title,
        description: update.description ?? task.description,
        status: effectiveStatus,
        priority: update.priority ?? task.priority,
        projectId: task.projectId,
        goalId: task.goalId,
        parentId: task.parentId,
        assigneeAgentId: newAssignee,
        workspaceId: task.workspaceId,
      };
      db.saveTask(input as Parameters<typeof db.saveTask>[0]);

      if (update.comment) {
        const agent = db.getAgent(token.agentId);
        db.addComment({
          companyId: task.companyId,
          taskId: task.id,
          authorAgentId: token.agentId,
          authorName: agent.name,
          body: update.comment,
        });
      }

      db.addActivity({
        companyId: task.companyId,
        actor: token.agentId,
        action: `task.${update.status ? "status_changed" : "updated"}`,
        entityType: "task",
        entityId: task.id,
        detail: update.comment ?? `Status → ${update.status ?? task.status}`,
      });

      onDomainChanged();

      // Fire automation rules for status changes
      const previousStatus = task.status;
      const newStatus = update.status ?? task.status;
      if (update.status && previousStatus !== newStatus) {
        callbacks.onTaskStatusChanged(task.id, task.companyId, previousStatus, newStatus);
      }

      if (update.status && ["done", "in_review"].includes(update.status)) {
        if (task.parentId) {
          try {
            const parentTask = db.getTask(task.parentId);
            if (parentTask.assigneeAgentId && parentTask.assigneeAgentId !== token.agentId) {
              onWakeAgent(parentTask.assigneeAgentId, task.companyId, "subtask_completed");
            }
          } catch { /* parent task may have been deleted */ }
        } else {
          const chain = db.getChainOfCommand(token.agentId);
          if (chain.length > 0) {
            onWakeAgent(chain[0].id, task.companyId, "subtask_completed");
          }
        }
      }

      if (update.status === "blocked") {
        const chain = db.getChainOfCommand(token.agentId);
        if (chain.length > 0) {
          onWakeAgent(chain[0].id, task.companyId, "report_blocked");
        }
      }

      if (update.status && ["in_progress", "todo"].includes(update.status) &&
          task.assigneeAgentId && task.assigneeAgentId !== token.agentId) {
        onWakeAgent(task.assigneeAgentId, task.companyId, "assignment");
      }

      if (update.comment) {
        // Fire comment automation rules
        callbacks.onCommentPosted(task.id, task.companyId, token.agentId);

        const wokenForComment = new Set<string>();
        if (task.assigneeAgentId && task.assigneeAgentId !== token.agentId) {
          onWakeAgent(task.assigneeAgentId, task.companyId, "comment");
          wokenForComment.add(task.assigneeAgentId);
        }
        const chain = db.getChainOfCommand(token.agentId);
        if (chain.length > 0 && chain[0].id !== token.agentId && !wokenForComment.has(chain[0].id)) {
          onWakeAgent(chain[0].id, task.companyId, "comment");
        }
      }

      // Wake new assignee when task is reassigned
      if (newAssignee && newAssignee !== task.assigneeAgentId && newAssignee !== token.agentId) {
        onWakeAgent(newAssignee, task.companyId, "assignment");
      }

      server.json(res, 200, { ok: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes("require an assignee")) {
        server.json(res, 422, { error: error.message });
        return;
      }
      if (error instanceof Error && error.message.includes("not found")) {
        server.json(res, 404, { error: error.message });
        return;
      }
      server.json(res, 500, { error: error instanceof Error ? error.message : "Task update failed" });
    }
  });

  server.addRoute("POST", "/api/companies/:companyId/issues", (_req, res, params, token, body) => {
    const companyId = requireParam(params, "companyId");
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const parsed = taskInputSchema.safeParse({
      companyId,
      ...(typeof body === "object" && body ? body : {}),
    });
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid task payload" });
      return;
    }
    const input = parsed.data;
    if (server.companyRefError(res, companyId, [
      { id: input.assigneeAgentId, table: "agents", label: "assignee" },
      { id: input.parentId, table: "tasks", label: "parent task" },
      { id: input.projectId, table: "projects", label: "project" },
      { id: input.goalId, table: "goals", label: "goal" },
      { id: input.workspaceId, table: "workspaces", label: "workspace" },
    ])) {
      return;
    }
    if (!canAssignTask(db, companyId, token.agentId, input.assigneeAgentId ?? null)) {
      server.json(res, 403, { error: "Current agent is not allowed to assign this task to the selected agent" });
      return;
    }
    const isHeartbeat = input.title.startsWith("[Heartbeat]");
    const taskValidation = validateTaskCreation({ title: input.title, description: input.description ?? "" }, isHeartbeat);
    if (!taskValidation.valid) {
      server.json(res, 422, { error: taskValidation.errors.join("; ") });
      return;
    }

    let id: string;
    try {
      id = db.saveTask({
        companyId,
        title: input.title,
        description: input.description ?? "",
        assigneeAgentId: input.assigneeAgentId ?? null,
        parentId: input.parentId ?? null,
        projectId: input.projectId ?? null,
        goalId: input.goalId ?? null,
        priority: input.priority,
        status: input.status,
        workspaceId: input.workspaceId ?? null,
      });
    } catch (error) {
      server.json(res, 422, { error: error instanceof Error ? error.message : "Task could not be saved" });
      return;
    }

    // Auto-infer task_type from assignee's department
    if (input.assigneeAgentId) {
      const assignee = db.getAgent(input.assigneeAgentId);
      const inferredType = inferTaskType(assignee.department);
      db.setTaskType(id, inferredType);
    }

    db.addActivity({
      companyId,
      actor: token.agentId,
      action: "task.created",
      entityType: "task",
      entityId: id,
      detail: input.title,
    });

    onDomainChanged();

    // Fire the full task creation event chain (automation rules, auto-assign, etc.)
    callbacks.onTaskCreated(id, companyId);

    // Also wake the assignee directly if specified
    if (input.assigneeAgentId && input.assigneeAgentId !== token.agentId) {
      onWakeAgent(input.assigneeAgentId, companyId, "assignment");
    }

    // If no assignee specified, auto-assign
    if (!input.assigneeAgentId) {
      const assignedId = callbacks.onAutoAssignTask(id, companyId);
      if (assignedId && assignedId !== token.agentId) {
        onWakeAgent(assignedId, companyId, "assignment");
      }
    }

    server.json(res, 201, { id });
  });

}
