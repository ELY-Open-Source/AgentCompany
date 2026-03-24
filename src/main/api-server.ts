import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import log from "electron-log/main.js";
import { z } from "zod";
import { agentMessageInputSchema, approvalInputSchema, goalInputSchema, hireRequestSchema, projectInputSchema, taskInputSchema } from "@shared/contracts";
import { getConnectorExecutionReadinessIssue } from "@shared/connector-policy";
import { validateAgentToken, type TokenPayload } from "./agent-auth";
import { canAssignTask, canControlAgent, canManageGoal, canManageOrganization, canManageProject, canUpdateTask } from "./agent-permissions";
import { resolveApprovalDecision, shouldAutoApproveApproval } from "./approval-policy";
import type { AppDatabase } from "./database";
import { inferTaskType } from "./connector-matching";
import { dispatchAgentMessage } from "./message-dispatch";
import type { DesktopEvent, SectionId } from "@shared/types";

/**
 * Decode an HTTP request body to a UTF-8 string, handling the common Windows
 * encoding issue where Chinese/CJK characters arrive in GBK (CP936) instead
 * of UTF-8. On Chinese Windows the system ANSI code page is GBK; tools like
 * curl encode command-line arguments using that code page when stdout is piped
 * (chcp 65001 does not help because there is no real console). We try strict
 * UTF-8 first and, only if the bytes are invalid UTF-8, fall back to GBK.
 */
function decodeBodyToUtf8(raw: Buffer): string {
  if (raw.length === 0) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    // Bytes are not valid UTF-8 — most likely GBK from Chinese Windows.
    try {
      return new TextDecoder("gbk").decode(raw);
    } catch {
      // Last resort: lossy UTF-8 (replaces invalid bytes with U+FFFD).
      return raw.toString("utf8");
    }
  }
}

type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  token: TokenPayload,
  body: unknown,
) => void | Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RequestHandler;
}

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

const approvalListQuerySchema = z.object({
  requestedByAgentId: z.string().uuid().optional(),
  relatedTaskId: z.string().uuid().optional(),
  status: z.string().optional(),
});

export interface ApiServerEventCallbacks {
  onDomainChanged: () => void;
  onWakeAgent: (agentId: string, companyId: string, trigger: string) => string | null;
  onTaskCreated: (taskId: string, companyId: string) => void;
  onTaskStatusChanged: (taskId: string, companyId: string, previousStatus: string, newStatus: string) => void;
  onCommentPosted: (taskId: string, companyId: string, authorAgentId: string | null) => void;
  onApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
  onDocumentCreated: (companyId: string, authorAgentId: string | null, projectId: string | null) => void;
  onAutoAssignTask: (taskId: string, companyId: string) => string | null;
  emitEvent: (event: DesktopEvent) => void;
  notify: (options: { title: string; body: string; urgency: "critical" | "informational"; navigation?: { section: SectionId; entityId?: string }; batchKey?: string }) => void;
}

export class AgentApiServer {
  private routes: Route[] = [];
  private server: ReturnType<typeof createServer> | null = null;
  private port = 0;
  private db: AppDatabase;
  private onDomainChanged: () => void;
  private onWakeAgent: (agentId: string, companyId: string, trigger: string) => string | null;
  private emitEvent: (event: DesktopEvent) => void;
  private callbacks: ApiServerEventCallbacks;
  private allowedOrigins: Set<string>;
  private onBrowserAction: ((actionId: string, companyId: string, socialAccountId: string, actionType: string, payload: Record<string, unknown>) => void) | null = null;

  constructor(
    db: AppDatabase,
    onDomainChanged: () => void,
    onWakeAgent: (agentId: string, companyId: string, trigger: string) => string | null,
    callbacks?: Partial<ApiServerEventCallbacks>,
    allowedOrigins: Iterable<string> = ["app://-"],
  ) {
    this.db = db;
    this.onDomainChanged = onDomainChanged;
    this.onWakeAgent = onWakeAgent;
    this.emitEvent = callbacks?.emitEvent ?? (() => {});
    this.allowedOrigins = new Set(Array.from(allowedOrigins).filter(Boolean));
    this.callbacks = {
      onDomainChanged,
      onWakeAgent,
      onTaskCreated: callbacks?.onTaskCreated ?? (() => {}),
      onTaskStatusChanged: callbacks?.onTaskStatusChanged ?? (() => {}),
      onCommentPosted: callbacks?.onCommentPosted ?? (() => {}),
      onApprovalResolved: callbacks?.onApprovalResolved ?? (() => {}),
      onDocumentCreated: callbacks?.onDocumentCreated ?? (() => {}),
      onAutoAssignTask: callbacks?.onAutoAssignTask ?? (() => null),
      emitEvent: callbacks?.emitEvent ?? (() => {}),
      notify: callbacks?.notify ?? (() => {}),
    };
    this.registerRoutes();
  }

  setBrowserActionHandler(handler: (actionId: string, companyId: string, socialAccountId: string, actionType: string, payload: Record<string, unknown>) => void) {
    this.onBrowserAction = handler;
  }

  getPort(): number {
    return this.port;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => void this.handleRequest(req, res));
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        log.info(`[api] Agent API server listening on http://127.0.0.1:${this.port}`);
        resolve(this.port);
      });
      this.server.on("error", reject);
    });
  }

  stop() {
    this.server?.close();
    this.server = null;
  }

  private addRoute(method: string, path: string, handler: RequestHandler) {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:(\w+)/g, (_match, name: string) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({ method, pattern: new RegExp(`^${patternStr}$`), paramNames, handler });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (origin) {
      if (!this.allowedOrigins.has(origin)) {
        this.json(res, 403, { error: "Origin not allowed" });
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Agent-Company-Run-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      this.json(res, 401, { error: "Missing or invalid Authorization header" });
      return;
    }
    const token = validateAgentToken(authHeader.slice(7));
    if (!token) {
      this.json(res, 401, { error: "Invalid or expired token" });
      return;
    }

    const runHeader = req.headers["x-agent-company-run-id"];
    const claimedRunId = Array.isArray(runHeader) ? runHeader[0] : runHeader;
    if (typeof claimedRunId !== "string" || claimedRunId.trim() !== token.runId) {
      this.json(res, 401, { error: "Missing or mismatched X-Agent-Company-Run-Id header" });
      return;
    }

    const runState = this.db.getRunAuthState(token.runId);
    if (!runState || runState.companyId !== token.companyId || runState.agentId !== token.agentId) {
      this.json(res, 403, { error: "Token references an unknown or mismatched run" });
      return;
    }

    if (!["queued", "running"].includes(runState.status)) {
      this.json(res, 401, { error: "Run token is no longer active" });
      return;
    }

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1]!;
      });

      let body: unknown = null;
      if (["POST", "PATCH", "PUT"].includes(method)) {
        try {
          body = await this.readBody(req);
        } catch (bodyErr) {
          if (bodyErr instanceof Error && bodyErr.message === "Request body too large") {
            this.json(res, 413, { error: "Request body too large (max 1 MB)" });
          } else {
            this.json(res, 400, { error: "Invalid JSON body" });
          }
          return;
        }
      }

      try {
        await route.handler(req, res, params, token, body);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[api] ${method} ${pathname}: ${message}`);
        this.json(res, 500, { error: "Internal server error" });
      }
      return;
    }

    this.json(res, 404, { error: "Not found" });
  }

  private readBody(req: IncomingMessage): Promise<unknown> {
    const MAX_BODY_BYTES = 1_048_576; // 1 MB
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      req.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) {
          req.destroy();
          reject(new Error("Request body too large"));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        try {
          const raw = Buffer.concat(chunks);
          const data = decodeBodyToUtf8(raw);
          resolve(data ? JSON.parse(data) : null);
        }
        catch { reject(new Error("Invalid JSON")); }
      });
      req.on("error", reject);
    });
  }

  private json(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  }

  private companyRefError(
    res: ServerResponse,
    companyId: string,
    refs: Array<{ id: string | null | undefined; table: "agents" | "goals" | "projects" | "tasks" | "workspaces" | "approvals"; label: string }>,
  ) {
    const invalid = refs.find((ref) => ref.id && !this.db.belongsToCompany(ref.table, ref.id, companyId));
    if (!invalid) return false;
    this.json(res, 422, { error: `${invalid.label} does not belong to the current company` });
    return true;
  }

  private registerRoutes() {
    this.addRoute("GET", "/api/agents/me", (_req, res, _params, token) => {
      const agent = this.db.getAgent(token.agentId);
      const chainOfCommand = this.db.getChainOfCommand(token.agentId);
      const directReports = this.db.getDirectReports(token.agentId, token.companyId);
      this.json(res, 200, { agent, chainOfCommand, directReports });
    });

    this.addRoute("GET", "/api/companies/:companyId/issues", (req, res, params, token) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
      const assigneeAgentId = url.searchParams.get("assigneeAgentId");
      const statusFilter = url.searchParams.get("status");
      const statuses = statusFilter ? statusFilter.split(",") : ["todo", "in_progress", "blocked"];

      if (assigneeAgentId) {
        const tasks = this.db.listAgentTasks(assigneeAgentId, companyId, statuses);
        this.json(res, 200, tasks);
      } else {
        const snapshot = this.db.listSnapshot();
        const tasks = snapshot.tasks.filter((t) => t.companyId === companyId && statuses.includes(t.status));
        this.json(res, 200, tasks);
      }
    });

    this.addRoute("GET", "/api/issues/:issueId", (_req, res, params, token) => {
      try {
        const task = this.db.getTask(params.issueId!);
        if (task.companyId !== token.companyId) {
          this.json(res, 404, { error: "Task not found" });
          return;
        }
        this.json(res, 200, task);
      } catch {
        this.json(res, 404, { error: "Task not found" });
      }
    });

    this.addRoute("POST", "/api/issues/:issueId/checkout", (_req, res, params, token, body) => {
      const parsedBody = checkoutSchema.safeParse(body);
      if (!parsedBody.success) {
        this.json(res, 400, { error: "Invalid checkout payload" });
        return;
      }
      const agentId = parsedBody.data.agentId ?? token.agentId;
      if (agentId !== token.agentId) {
        this.json(res, 403, { error: "Agents can only checkout work for themselves" });
        return;
      }
      let task;
      try {
        task = this.db.getTask(params.issueId!);
      } catch {
        this.json(res, 404, { error: "Task not found" });
        return;
      }
      if (task.companyId !== token.companyId) {
        this.json(res, 404, { error: "Task not found" });
        return;
      }
      if (task.assigneeAgentId && !canUpdateTask(this.db, token.companyId, token.agentId, task)) {
        this.json(res, 403, { error: "Current agent is not allowed to checkout this task" });
        return;
      }
      const previousStatus = task.status;
      const success = this.db.checkoutTask(params.issueId!, agentId);
      if (!success) {
        this.json(res, 409, { error: "Task cannot be checked out — already assigned or not in valid status" });
        return;
      }
      this.onDomainChanged();
      // Checkout changes status from todo/backlog to in_progress — use actual previous status
      this.callbacks.onTaskStatusChanged(task.id, task.companyId, previousStatus, "in_progress");
      this.json(res, 200, { ok: true });
    });

    this.addRoute("PATCH", "/api/issues/:issueId", (_req, res, params, token, body) => {
      const parsedUpdate = taskUpdateSchema.safeParse(body);
      if (!parsedUpdate.success) {
        this.json(res, 400, { error: "Invalid task update payload" });
        return;
      }
      const update = parsedUpdate.data;

      try {
        const task = this.db.getTask(params.issueId!);
        if (task.companyId !== token.companyId) {
          this.json(res, 404, { error: "Task not found" });
          return;
        }
        if (!canUpdateTask(this.db, token.companyId, token.agentId, task)) {
          this.json(res, 403, { error: "Current agent is not allowed to update this task" });
          return;
        }

        const newAssignee = update.assigneeAgentId !== undefined ? update.assigneeAgentId : task.assigneeAgentId;
        if (!canAssignTask(this.db, token.companyId, token.agentId, newAssignee ?? null)) {
          this.json(res, 403, { error: "Current agent is not allowed to assign this task to the selected agent" });
          return;
        }

        // Deliverable review gate: intercept agent trying to advance a flagged task to "done"
        let deliverableReviewIntercepted = false;
        if (update.status === "done" && task.requiresUserReview) {
          try {
            const importantTypes = ["prd","technical_spec","design_doc","project_brief","proposal","budget_proposal","architecture_decision","contract","sop"];
            const placeholders = importantTypes.map(() => "?").join(", ");
            // Scope to documents authored by the task's agent, created during this task's lifetime
            const docs = this.db.queryAll<{ id: string; type: string; title: string }>(
              `select id, type, title from documents where company_id = ? and type in (${placeholders})
               and (author_agent_id = ? or created_at >= (select created_at from tasks where id = ?))
               order by created_at desc limit 10`,
              task.companyId, ...importantTypes, task.assigneeAgentId ?? "", task.id,
            );
            const reviewerAgent = this.db.getAgent(token.agentId);
            const docTitles = docs.map((d) => d.title).join(", ");
            this.db.requestApproval({
              companyId: task.companyId,
              relatedTaskId: task.id,
              requestedByAgentId: token.agentId,
              type: "deliverable_review",
              payloadSummary: `Review deliverable: ${docTitles || task.title}`.slice(0, 280),
              impactSummary: `${reviewerAgent.name} reviewed and approved. Awaiting your final review.`.slice(0, 400),
              payloadJson: JSON.stringify({ documentIds: docs.map((d) => d.id), documents: docs }),
            });
            this.db.setTaskRequiresUserReview(task.id, false);
            // Pause the producing agent's heartbeat until user reviews
            if (task.assigneeAgentId) {
              try {
                const prodAgent = this.db.getAgent(task.assigneeAgentId);
                if (prodAgent.heartbeatEnabled) {
                  this.db.setHeartbeat(task.assigneeAgentId, false, prodAgent.heartbeatIntervalSec || 120);
                }
              } catch { /* best effort */ }
            }
            this.db.addComment({ companyId: task.companyId, taskId: task.id, authorAgentId: null, authorName: "System", body: "Deliverable submitted for board review." });
            update.status = "in_review"; // Override: keep in review, don't advance to done
            deliverableReviewIntercepted = true;
          } catch { /* deliverable review interception is best-effort; fall through to normal flow */ }
        }

        const input: Record<string, unknown> = {
          id: task.id,
          companyId: task.companyId,
          title: update.title ?? task.title,
          description: update.description ?? task.description,
          status: update.status ?? task.status,
          priority: update.priority ?? task.priority,
          projectId: task.projectId,
          goalId: task.goalId,
          parentId: task.parentId,
          assigneeAgentId: newAssignee,
          workspaceId: task.workspaceId,
        };
        this.db.saveTask(input as Parameters<typeof this.db.saveTask>[0]);

        if (update.comment) {
          const agent = this.db.getAgent(token.agentId);
          this.db.addComment({
            companyId: task.companyId,
            taskId: task.id,
            authorAgentId: token.agentId,
            authorName: agent.name,
            body: update.comment,
          });
        }

        this.db.addActivity({
          companyId: task.companyId,
          actor: token.agentId,
          action: `task.${update.status ? "status_changed" : "updated"}`,
          entityType: "task",
          entityId: task.id,
          detail: update.comment ?? `Status → ${update.status ?? task.status}`,
        });

        this.onDomainChanged();

        // Fire automation rules for status changes
        const previousStatus = task.status;
        const newStatus = update.status ?? task.status;
        if (update.status && previousStatus !== newStatus) {
          this.callbacks.onTaskStatusChanged(task.id, task.companyId, previousStatus, newStatus);
        }

        if (update.status && ["done", "in_review"].includes(update.status)) {
          if (task.parentId) {
            try {
              const parentTask = this.db.getTask(task.parentId);
              if (parentTask.assigneeAgentId && parentTask.assigneeAgentId !== token.agentId) {
                this.onWakeAgent(parentTask.assigneeAgentId, task.companyId, "subtask_completed");
              }
            } catch { /* parent task may have been deleted */ }
          } else {
            const chain = this.db.getChainOfCommand(token.agentId);
            if (chain.length > 0) {
              this.onWakeAgent(chain[0].id, task.companyId, "subtask_completed");
            }
          }
        }

        if (update.status === "blocked") {
          const chain = this.db.getChainOfCommand(token.agentId);
          if (chain.length > 0) {
            this.onWakeAgent(chain[0].id, task.companyId, "report_blocked");
          }
        }

        if (update.status && ["in_progress", "todo"].includes(update.status) &&
            task.assigneeAgentId && task.assigneeAgentId !== token.agentId) {
          this.onWakeAgent(task.assigneeAgentId, task.companyId, "assignment");
        }

        if (update.comment) {
          // Fire comment automation rules
          this.callbacks.onCommentPosted(task.id, task.companyId, token.agentId);

          const wokenForComment = new Set<string>();
          if (task.assigneeAgentId && task.assigneeAgentId !== token.agentId) {
            this.onWakeAgent(task.assigneeAgentId, task.companyId, "comment");
            wokenForComment.add(task.assigneeAgentId);
          }
          const chain = this.db.getChainOfCommand(token.agentId);
          if (chain.length > 0 && chain[0].id !== token.agentId && !wokenForComment.has(chain[0].id)) {
            this.onWakeAgent(chain[0].id, task.companyId, "comment");
          }
        }

        // Wake new assignee when task is reassigned
        if (newAssignee && newAssignee !== task.assigneeAgentId && newAssignee !== token.agentId) {
          this.onWakeAgent(newAssignee, task.companyId, "assignment");
        }

        this.json(res, 200, { ok: true });
      } catch (error) {
        if (error instanceof Error && error.message.includes("require an assignee")) {
          this.json(res, 422, { error: error.message });
          return;
        }
        this.json(res, 404, { error: "Task not found" });
      }
    });

    this.addRoute("POST", "/api/companies/:companyId/issues", (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const parsed = taskInputSchema.safeParse({
        companyId,
        ...(typeof body === "object" && body ? body : {}),
      });
      if (!parsed.success) {
        this.json(res, 400, { error: "Invalid task payload" });
        return;
      }
      const input = parsed.data;
      if (this.companyRefError(res, companyId, [
        { id: input.assigneeAgentId, table: "agents", label: "assignee" },
        { id: input.parentId, table: "tasks", label: "parent task" },
        { id: input.projectId, table: "projects", label: "project" },
        { id: input.goalId, table: "goals", label: "goal" },
        { id: input.workspaceId, table: "workspaces", label: "workspace" },
      ])) {
        return;
      }
      if (!canAssignTask(this.db, companyId, token.agentId, input.assigneeAgentId ?? null)) {
        this.json(res, 403, { error: "Current agent is not allowed to assign this task to the selected agent" });
        return;
      }

      let id: string;
      try {
        id = this.db.saveTask({
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
        this.json(res, 422, { error: error instanceof Error ? error.message : "Task could not be saved" });
        return;
      }

      // Auto-infer task_type from assignee's department
      if (input.assigneeAgentId) {
        try {
          const assignee = this.db.getAgent(input.assigneeAgentId);
          const inferredType = inferTaskType(assignee.department);
          this.db.setTaskType(id, inferredType);
        } catch { /* best effort -- agent may not exist or setTaskType may fail */ }
      }

      this.db.addActivity({
        companyId,
        actor: token.agentId,
        action: "task.created",
        entityType: "task",
        entityId: id,
        detail: input.title,
      });

      this.onDomainChanged();

      // Fire the full task creation event chain (automation rules, auto-assign, etc.)
      this.callbacks.onTaskCreated(id, companyId);

      // Also wake the assignee directly if specified
      if (input.assigneeAgentId && input.assigneeAgentId !== token.agentId) {
        this.onWakeAgent(input.assigneeAgentId, companyId, "assignment");
      }

      // If no assignee specified, auto-assign
      if (!input.assigneeAgentId) {
        const assignedId = this.callbacks.onAutoAssignTask(id, companyId);
        if (assignedId && assignedId !== token.agentId) {
          this.onWakeAgent(assignedId, companyId, "assignment");
        }
      }

      this.json(res, 201, { id });
    });

    this.addRoute("POST", "/api/companies/:companyId/projects", (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const parsed = projectInputSchema.safeParse({
        companyId,
        ...(typeof body === "object" && body ? body : {}),
      });
      if (!parsed.success) {
        this.json(res, 400, { error: "Invalid project payload" });
        return;
      }
      const input = parsed.data;
      if (this.companyRefError(res, companyId, [
        { id: input.goalId, table: "goals", label: "goal" },
        { id: input.leadAgentId, table: "agents", label: "lead agent" },
      ])) {
        return;
      }
      if (!canManageProject(this.db, companyId, token.agentId, input.leadAgentId ?? null)) {
        this.json(res, 403, { error: "Current agent is not allowed to create or assign this project" });
        return;
      }

      const id = this.db.saveProject({
        companyId,
        name: input.name,
        description: input.description ?? "",
        goalId: input.goalId ?? null,
        leadAgentId: input.leadAgentId ?? null,
        status: (input.status as "planned") ?? "planned",
        targetDate: input.targetDate ?? null,
      });

      this.db.addActivity({
        companyId,
        actor: token.agentId,
        action: "project.created",
        entityType: "project",
        entityId: id,
        detail: input.name,
      });

      this.onDomainChanged();
      if (input.leadAgentId && input.leadAgentId !== token.agentId) {
        this.onWakeAgent(input.leadAgentId, companyId, "assignment");
      }
      this.json(res, 201, { id });
    });

    this.addRoute("PATCH", "/api/projects/:projectId", (_req, res, params, token, body) => {
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
        this.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() });
        return;
      }

      const snapshot = this.db.listSnapshot();
      const existing = snapshot.projects.find(p => p.id === projectId && p.companyId === token.companyId);
      if (!existing) {
        this.json(res, 404, { error: "Project not found" });
        return;
      }
      const nextLeadAgentId = parsed.data.leadAgentId ?? existing.leadAgentId ?? null;
      if (!canManageProject(this.db, token.companyId, token.agentId, nextLeadAgentId)) {
        this.json(res, 403, { error: "Current agent is not allowed to update this project" });
        return;
      }

      try {
        this.db.saveProject({
          id: projectId,
          companyId: token.companyId,
          name: parsed.data.name ?? existing.name,
          description: parsed.data.description ?? existing.description,
          status: parsed.data.status ?? existing.status,
          leadAgentId: nextLeadAgentId,
          goalId: parsed.data.goalId !== undefined ? parsed.data.goalId : (existing.goalId ?? null),
          targetDate: parsed.data.targetDate !== undefined ? parsed.data.targetDate : (existing.targetDate ?? null),
        });
        this.onDomainChanged();
        this.json(res, 200, { ok: true });
      } catch {
        this.json(res, 500, { error: "Failed to update project" });
      }
    });

    this.addRoute("POST", "/api/companies/:companyId/goals", (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const parsed = goalInputSchema.safeParse({
        companyId,
        ...(typeof body === "object" && body ? body : {}),
      });
      if (!parsed.success) {
        this.json(res, 400, { error: "Invalid goal payload" });
        return;
      }
      const input = parsed.data;
      if (this.companyRefError(res, companyId, [
        { id: input.parentId, table: "goals", label: "parent goal" },
        { id: input.ownerAgentId, table: "agents", label: "owner agent" },
      ])) {
        return;
      }
      if (!canManageGoal(this.db, companyId, token.agentId, input.ownerAgentId ?? null)) {
        this.json(res, 403, { error: "Current agent is not allowed to create this goal" });
        return;
      }

      const id = this.db.saveGoal(input);
      this.db.addActivity({
        companyId,
        actor: token.agentId,
        action: "goal.created",
        entityType: "goal",
        entityId: id,
        detail: input.title,
      });
      this.onDomainChanged();
      if (input.ownerAgentId && input.ownerAgentId !== token.agentId && input.status === "active") {
        this.onWakeAgent(input.ownerAgentId, companyId, "goal_activated");
      }
      this.json(res, 201, { id });
    });

    this.addRoute("PATCH", "/api/goals/:goalId", (_req, res, params, token, body) => {
      const goalId = params.goalId!;

      const updateSchema = z.object({
        title: z.string().min(2).max(120).optional(),
        description: z.string().max(2000).optional(),
        status: z.enum(["planned", "active", "achieved", "cancelled"]).optional(),
        ownerAgentId: z.string().uuid().optional(),
      });

      const parsed = updateSchema.safeParse(body);
      if (!parsed.success) {
        this.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() });
        return;
      }

      const snapshot = this.db.listSnapshot();
      const existing = snapshot.goals.find(g => g.id === goalId && g.companyId === token.companyId);
      if (!existing) {
        this.json(res, 404, { error: "Goal not found" });
        return;
      }
      const nextOwnerAgentId = parsed.data.ownerAgentId ?? existing.ownerAgentId ?? null;
      if (!canManageGoal(this.db, token.companyId, token.agentId, nextOwnerAgentId)) {
        this.json(res, 403, { error: "Current agent is not allowed to update this goal" });
        return;
      }

      try {
        this.db.saveGoal({
          id: goalId,
          companyId: token.companyId,
          title: parsed.data.title ?? existing.title,
          description: parsed.data.description ?? existing.description,
          status: parsed.data.status ?? existing.status,
          ownerAgentId: nextOwnerAgentId,
        });
        this.onDomainChanged();
        this.json(res, 200, { ok: true });
      } catch {
        this.json(res, 500, { error: "Failed to update goal" });
      }
    });

    this.addRoute("POST", "/api/companies/:companyId/agents", (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      if (!canManageOrganization(this.db, companyId, token.agentId)) {
        this.json(res, 403, { error: "Current agent is not allowed to request hires" });
        return;
      }
      const parsed = hireRequestSchema.safeParse({
        companyId,
        requestedByAgentId: token.agentId,
        ...(typeof body === "object" && body ? body : {}),
        reportsTo:
          typeof body === "object" && body && "reportsTo" in body
            ? (body as { reportsTo?: string | null }).reportsTo
            : token.agentId,
      });
      if (!parsed.success) {
        this.json(res, 400, { error: "Invalid hire payload" });
        return;
      }
      const input = parsed.data;
      if (this.companyRefError(res, companyId, [
        { id: input.requestedByAgentId, table: "agents", label: "requesting agent" },
        { id: input.reportsTo, table: "agents", label: "manager" },
        { id: input.workspaceId, table: "workspaces", label: "workspace" },
      ])) {
        return;
      }
      const connectorRecord = (() => {
        try {
          return this.db.getConnector(input.connectorId);
        } catch {
          return null;
        }
      })();
      if (!connectorRecord) {
        this.json(res, 422, { error: "The selected connector does not exist." });
        return;
      }
      const connectorIssue = getConnectorExecutionReadinessIssue(connectorRecord);
      if (connectorIssue) {
        this.json(res, 422, { error: connectorIssue });
        return;
      }

      const managerLabel = input.reportsTo
        ? (() => {
          try {
            return this.db.getAgent(input.reportsTo).name;
          } catch {
            return input.reportsTo;
          }
        })()
        : "the company board";

      let result: { agentId: string; approvalId: string };
      try {
        result = this.db.createHireRequest({
          companyId,
          requestedByAgentId: input.requestedByAgentId ?? token.agentId,
          name: input.name,
          role: input.role,
          title: input.title,
          department: input.department ?? null,
          reportsTo: input.reportsTo ?? token.agentId,
          connectorId: input.connectorId,
          workspaceId: input.workspaceId ?? null,
          model: input.model ?? null,
          metadataJson: input.metadataJson ?? "{}",
          capabilities: input.capabilities,
          budgetMonthlyUsd: input.budgetMonthlyUsd,
          payloadSummary: `Hire ${input.name} as ${input.role}`,
          impactSummary: input.capabilities || `${input.name} will report to ${managerLabel}.`,
          payloadJson: JSON.stringify({
            requestedByAgentId: input.requestedByAgentId ?? token.agentId,
            requestedConfigurationSnapshot: {
              connectorId: input.connectorId,
              workspaceId: input.workspaceId ?? null,
              model: input.model ?? null,
              metadataJson: input.metadataJson ?? "{}",
              capabilities: input.capabilities,
              budgetMonthlyUsd: input.budgetMonthlyUsd,
              reportsTo: input.reportsTo ?? token.agentId,
              department: input.department ?? null,
              title: input.title,
            },
          }),
        });
      } catch (error) {
        this.json(res, 422, { error: error instanceof Error ? error.message : "Hire could not be created" });
        return;
      }

      this.db.addActivity({
        companyId,
        actor: token.agentId,
        action: "agent.hire_requested",
        entityType: "agent",
        entityId: result.agentId,
        detail: input.name,
      });

      let autoApproved = false;
      if (shouldAutoApproveApproval(this.db, companyId, "hire_agent")) {
        resolveApprovalDecision({
          db: this.db,
          handleApprovalResolved: this.callbacks.onApprovalResolved,
          companyId,
          approvalId: result.approvalId,
          state: "approved",
          decisionNote: "Auto-approved by company policy",
          detail: `Auto-approved hire: ${input.name}`,
        });
        autoApproved = true;
        log.info(`[auto-approve] Auto-approved hire of ${input.name} via agent API`);
      }

      this.onDomainChanged();
      this.json(res, 201, { ...result, autoApproved });
    });

    this.addRoute("POST", "/api/issues/:issueId/comments", (_req, res, params, token, body) => {
      const input = body as { body?: string } | null;
      if (!input?.body || typeof input.body !== "string") {
        this.json(res, 400, { error: "body is required" });
        return;
      }
      if (input.body.length > 4000) {
        this.json(res, 400, { error: "Comment body must not exceed 4000 characters" });
        return;
      }
      try {
        const task = this.db.getTask(params.issueId!);
        if (task.companyId !== token.companyId) {
          this.json(res, 404, { error: "Task not found" });
          return;
        }
        const agent = this.db.getAgent(token.agentId);
        const comment = this.db.addComment({
          companyId: task.companyId,
          taskId: task.id,
          authorAgentId: token.agentId,
          authorName: agent.name,
          body: input.body,
        });
        this.onDomainChanged();

        // Fire comment automation rules
        this.callbacks.onCommentPosted(task.id, task.companyId, token.agentId);

        const wokenForComment = new Set<string>();
        if (task.assigneeAgentId && task.assigneeAgentId !== token.agentId) {
          this.onWakeAgent(task.assigneeAgentId, task.companyId, "comment");
          wokenForComment.add(task.assigneeAgentId);
        }

        const chain = this.db.getChainOfCommand(token.agentId);
        if (chain.length > 0 && chain[0].id !== token.agentId && !wokenForComment.has(chain[0].id)) {
          this.onWakeAgent(chain[0].id, task.companyId, "comment");
        }

        this.json(res, 201, comment);
      } catch {
        this.json(res, 404, { error: "Task not found" });
      }
    });

    this.addRoute("GET", "/api/issues/:issueId/comments", (_req, res, params, token) => {
      try {
        const task = this.db.getTask(params.issueId!);
        if (task.companyId !== token.companyId) {
          this.json(res, 404, { error: "Task not found" });
          return;
        }
      } catch {
        this.json(res, 404, { error: "Task not found" });
        return;
      }
      const comments = this.db.listComments(params.issueId!);
      this.json(res, 200, comments);
    });

    this.addRoute("POST", "/api/companies/:companyId/approvals", (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const parsed = approvalInputSchema.safeParse({
        companyId,
        ...(typeof body === "object" && body ? body : {}),
        requestedByAgentId: token.agentId,
      });
      if (!parsed.success) {
        this.json(res, 400, { error: "Invalid approval payload" });
        return;
      }
      const input = parsed.data;
      if (this.companyRefError(res, companyId, [
        { id: input.relatedTaskId, table: "tasks", label: "related task" },
        { id: token.agentId, table: "agents", label: "requesting agent" },
        { id: input.relatedAgentId, table: "agents", label: "related agent" },
      ])) {
        return;
      }

      let id: string;
      try {
        id = this.db.requestApproval({
          companyId,
          type: input.type,
          relatedTaskId: input.relatedTaskId ?? null,
          requestedByAgentId: token.agentId,
          relatedAgentId: input.relatedAgentId ?? null,
          payloadSummary: input.payloadSummary,
          impactSummary: input.impactSummary,
          payloadJson: input.payloadJson ?? null,
        });
      } catch (error) {
        this.json(res, 422, { error: error instanceof Error ? error.message : "Approval could not be created" });
        return;
      }

      this.db.addActivity({
        companyId,
        actor: token.agentId,
        action: "approval.created",
        entityType: "approval",
        entityId: id,
        detail: input.payloadSummary,
      });

      if (shouldAutoApproveApproval(this.db, companyId, input.type)) {
        resolveApprovalDecision({
          db: this.db,
          handleApprovalResolved: this.callbacks.onApprovalResolved,
          companyId,
          approvalId: id,
          state: "approved",
          decisionNote: "Auto-approved by company policy",
          detail: "Auto-approved by company policy",
        });
        log.info(`[auto-approve] Auto-approved approval ${id}: ${input.payloadSummary}`);
      } else {
        this.callbacks.notify({
          title: "Approval Required",
          body: input.payloadSummary ?? `${input.type} approval pending`,
          urgency: "critical",
          navigation: { section: "approvals", entityId: id },
          batchKey: "pending_approval",
        });
      }

      this.onDomainChanged();
      this.json(res, 201, { id });
    });

    this.addRoute("GET", "/api/companies/:companyId/approvals", (req, res, params, token) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
      const parsedQuery = approvalListQuerySchema.safeParse({
        requestedByAgentId: url.searchParams.get("requestedByAgentId") ?? undefined,
        relatedTaskId: url.searchParams.get("relatedTaskId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      });
      if (!parsedQuery.success) {
        this.json(res, 400, { error: "Invalid approval query" });
        return;
      }
      const statuses = parsedQuery.data.status?.split(",").filter(Boolean) ?? null;
      const snapshot = this.db.listSnapshot();
      const approvals = snapshot.approvals.filter((approval) => {
        if (approval.companyId !== companyId) return false;
        if (parsedQuery.data.requestedByAgentId && approval.requestedByAgentId !== parsedQuery.data.requestedByAgentId) return false;
        if (parsedQuery.data.relatedTaskId && approval.relatedTaskId !== parsedQuery.data.relatedTaskId) return false;
        if (statuses && !statuses.includes(approval.state)) return false;
        return true;
      });
      this.json(res, 200, approvals);
    });

    this.addRoute("GET", "/api/approvals/:approvalId", (_req, res, params, token) => {
      const snapshot = this.db.listSnapshot();
      const approval = snapshot.approvals.find((a) => a.id === params.approvalId && a.companyId === token.companyId);
      if (!approval) {
        this.json(res, 404, { error: "Approval not found" });
        return;
      }
      this.json(res, 200, approval);
    });

    this.addRoute("PATCH", "/api/approvals/:approvalId", (_req, res) => {
      this.json(res, 403, { error: "Approvals must be decided from the desktop board, not from an agent run token" });
    });

    this.addRoute("GET", "/api/companies/:companyId/agents", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const agents = snapshot.agents.filter((a) => a.companyId === params.companyId);
      this.json(res, 200, agents);
    });

    this.addRoute("GET", "/api/companies/:companyId/goals", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const goals = snapshot.goals.filter((g) => g.companyId === params.companyId);
      this.json(res, 200, goals);
    });

    this.addRoute("GET", "/api/companies/:companyId/projects", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const projects = snapshot.projects.filter((p) => p.companyId === params.companyId);
      this.json(res, 200, projects);
    });

    this.addRoute("GET", "/api/agents/me/standup", (_req, res, _params, token) => {
      const snapshot = this.db.listSnapshot();
      const agent = snapshot.agents.find((a) => a.id === token.agentId);
      if (!agent) {
        this.json(res, 404, { error: "Agent not found" });
        return;
      }

      const myTasks = snapshot.tasks.filter((t) => t.assigneeAgentId === token.agentId && t.companyId === token.companyId);
      const directReports = snapshot.agents.filter((a) => a.reportsTo === token.agentId && a.companyId === token.companyId);
      const reportIds = new Set(directReports.map((a) => a.id));
      const reportTasks = snapshot.tasks.filter((t) => t.assigneeAgentId && reportIds.has(t.assigneeAgentId) && t.companyId === token.companyId);

      const tasksAwaitingMyReview = reportTasks.filter((t) => t.status === "in_review");
      const blockedReportTasks = reportTasks.filter((t) => t.status === "blocked");
      const myBlockedTasks = myTasks.filter((t) => t.status === "blocked");
      const myInProgressTasks = myTasks.filter((t) => t.status === "in_progress");
      const myTodoTasks = myTasks.filter((t) => t.status === "todo");

      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const recentComments = snapshot.comments
        .filter((c) => {
          const isMyTask = myTasks.some((t) => t.id === c.taskId);
          const isReportTask = reportTasks.some((t) => t.id === c.taskId);
          return (isMyTask || isReportTask) && new Date(c.createdAt).getTime() > twoHoursAgo;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 20);

      const myPendingApprovals = snapshot.approvals.filter(
        (a) => a.requestedByAgentId === token.agentId && a.state === "pending" && a.companyId === token.companyId,
      );
      const myResolvedApprovals = snapshot.approvals.filter(
        (a) => a.requestedByAgentId === token.agentId && a.state !== "pending" && a.companyId === token.companyId,
      ).slice(0, 5);

      this.json(res, 200, {
        agent: { id: agent.id, name: agent.name, role: agent.role, status: agent.status },
        summary: {
          tasksAwaitingReview: tasksAwaitingMyReview.length,
          blockedReportTasks: blockedReportTasks.length,
          myBlockedTasks: myBlockedTasks.length,
          myInProgress: myInProgressTasks.length,
          myTodo: myTodoTasks.length,
          pendingApprovals: myPendingApprovals.length,
          directReports: directReports.length,
        },
        tasksAwaitingReview: tasksAwaitingMyReview.map((t) => ({
          id: t.id,
          title: t.title,
          assignee: snapshot.agents.find((a) => a.id === t.assigneeAgentId)?.name ?? "Unknown",
          priority: t.priority,
        })),
        blockedTasks: [...blockedReportTasks, ...myBlockedTasks].map((t) => ({
          id: t.id,
          title: t.title,
          assignee: snapshot.agents.find((a) => a.id === t.assigneeAgentId)?.name ?? "Unknown",
          priority: t.priority,
        })),
        recentComments: recentComments.map((c) => ({
          taskId: c.taskId,
          taskTitle: snapshot.tasks.find((t) => t.id === c.taskId)?.title ?? "",
          author: c.authorName,
          body: c.body.slice(0, 200),
          createdAt: c.createdAt,
        })),
        pendingApprovals: myPendingApprovals.map((a) => ({
          id: a.id,
          type: a.type,
          summary: a.payloadSummary,
          state: a.state,
        })),
        resolvedApprovals: myResolvedApprovals.map((a) => ({
          id: a.id,
          type: a.type,
          summary: a.payloadSummary,
          state: a.state,
          decisionNote: a.decisionNote,
        })),
        reportStatuses: directReports.map((r) => {
          const rTasks = snapshot.tasks.filter((t) => t.assigneeAgentId === r.id && t.companyId === token.companyId);
          return {
            id: r.id,
            name: r.name,
            role: r.role,
            status: r.status,
            tasksInProgress: rTasks.filter((t) => t.status === "in_progress").length,
            tasksInReview: rTasks.filter((t) => t.status === "in_review").length,
            tasksBlocked: rTasks.filter((t) => t.status === "blocked").length,
            tasksDone: rTasks.filter((t) => t.status === "done").length,
          };
        }),
        socialAccounts: snapshot.socialAccounts
          .filter((a) => a.companyId === token.companyId)
          .map((a) => ({
            id: a.id,
            platform: a.platform,
            accountName: a.accountName,
            displayName: a.displayName,
            status: a.status,
            requireApproval: a.requireApproval,
          })),
      });
    });

    this.addRoute("POST", "/api/companies/:companyId/browser/action", async (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }

      const actionSchema = z.object({
        socialAccountId: z.string().uuid(),
        actionType: z.enum(["post", "reply", "like", "follow", "browse_feed", "screenshot", "navigate", "search"]),
        payload: z.record(z.string(), z.unknown()).default({}),
      });

      const parsed = actionSchema.safeParse(body);
      if (!parsed.success) {
        this.json(res, 400, { error: "Invalid browser action payload", details: parsed.error.issues });
        return;
      }

      const input = parsed.data;

      const snapshot = this.db.listSnapshot();
      const account = snapshot.socialAccounts.find(a => a.id === input.socialAccountId && a.companyId === companyId);
      if (!account) {
        this.json(res, 404, { error: "Social account not found" });
        return;
      }

      const postActions = ["post", "reply", "dm"];
      if (account.requireApproval && postActions.includes(input.actionType)) {
        const approvalId = this.db.requestApproval({
          companyId,
          type: "dangerous_command",
          relatedTaskId: null,
          requestedByAgentId: token.agentId,
          payloadSummary: `${input.actionType} on ${account.platform}/@${account.accountName}: ${String(input.payload.content || "").slice(0, 100)}`,
          impactSummary: `Will ${input.actionType} on ${account.displayName || account.accountName}'s ${account.platform} account. Content will be publicly visible.`,
        });

        const actionId = this.db.saveBrowserAction({
          companyId,
          socialAccountId: input.socialAccountId,
          agentId: token.agentId,
          actionType: input.actionType,
          payloadJson: JSON.stringify(input.payload),
          status: "approval_required",
          approvalId,
        });

        this.db.addActivity({
          companyId,
          actor: token.agentId,
          action: "browser.action_pending_approval",
          entityType: "browser_action",
          entityId: actionId,
          detail: `${input.actionType} on ${account.platform} requires approval`,
        });

        this.onDomainChanged();
        this.json(res, 202, { id: actionId, status: "approval_required", approvalId, message: "Action requires Board approval before execution" });
        return;
      }

      const actionId = this.db.saveBrowserAction({
        companyId,
        socialAccountId: input.socialAccountId,
        agentId: token.agentId,
        actionType: input.actionType,
        payloadJson: JSON.stringify(input.payload),
        status: "queued",
      });

      this.db.addActivity({
        companyId,
        actor: token.agentId,
        action: "browser.action_queued",
        entityType: "browser_action",
        entityId: actionId,
        detail: `${input.actionType} on ${account.platform}/@${account.accountName}`,
      });

      this.onDomainChanged();

      if (this.onBrowserAction) {
        this.onBrowserAction(actionId, companyId, input.socialAccountId, input.actionType, input.payload as Record<string, unknown>);
      }

      this.json(res, 201, { id: actionId, status: "queued", message: "Browser action queued for execution" });
    });

    this.addRoute("GET", "/api/companies/:companyId/social-accounts", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const accounts = this.db.listSocialAccounts(params.companyId!);
      const sanitized = accounts.map(a => ({
        id: a.id,
        platform: a.platform,
        accountName: a.accountName,
        displayName: a.displayName,
        profileUrl: a.profileUrl,
        status: a.status,
        requireApproval: a.requireApproval,
      }));
      this.json(res, 200, sanitized);
    });

    const socialDraftSchema = z.object({
      socialAccountId: z.string().uuid(),
      platform: z.string(),
      content: z.string().min(1).max(10000),
      mediaUrls: z.array(z.string()).default([]),
      scheduledAt: z.string().datetime().optional(),
    });

    this.addRoute("POST", "/api/companies/:companyId/social/draft", async (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }

      const parsed = socialDraftSchema.safeParse(body);
      if (!parsed.success) {
        this.json(res, 400, { error: "Invalid draft", details: parsed.error.issues });
        return;
      }

      const account = this.db.getSocialAccount(parsed.data.socialAccountId, companyId);
      if (!account) {
        this.json(res, 404, { error: "Social account not found" });
        return;
      }

      const contentPreview = parsed.data.content.slice(0, 120) + (parsed.data.content.length > 120 ? "..." : "");

      const approvalId = this.db.requestApproval({
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

      this.onDomainChanged();
      this.json(res, 201, { approvalId, status: "pending_approval" });
    });

    this.addRoute("GET", "/api/companies/:companyId/browser/actions", (req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
      const socialAccountId = url.searchParams.get("socialAccountId") ?? undefined;
      const status = url.searchParams.get("status") ?? undefined;
      const limit = Number(url.searchParams.get("limit") || 50);

      const actions = this.db.listBrowserActions(params.companyId!, { socialAccountId, status, limit });
      this.json(res, 200, actions);
    });

    this.addRoute("POST", "/api/companies/:companyId/documents", (_req, res, params, token, body) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const data = body as Record<string, unknown>;
      const reviewerAgentId = data.reviewerAgentId ? String(data.reviewerAgentId) : null;
      const projectId = data.projectId ? String(data.projectId) : null;
      const goalId = data.goalId ? String(data.goalId) : null;
      if (reviewerAgentId && !this.db.belongsToCompany("agents", reviewerAgentId, token.companyId)) {
        this.json(res, 400, { error: "Reviewer agent does not belong to the current company" });
        return;
      }
      if (projectId && !this.db.belongsToCompany("projects", projectId, token.companyId)) {
        this.json(res, 400, { error: "Project does not belong to the current company" });
        return;
      }
      if (goalId && !this.db.belongsToCompany("goals", goalId, token.companyId)) {
        this.json(res, 400, { error: "Goal does not belong to the current company" });
        return;
      }
      const docType = String(data.type ?? "knowledge_article");
      const docTitle = String(data.title ?? "Untitled");
      const id = this.db.saveDocument({
        companyId: token.companyId,
        type: docType,
        title: docTitle,
        content: String(data.content ?? ""),
        authorAgentId: token.agentId,
        reviewerAgentId,
        projectId,
        goalId,
        status: String(data.status ?? "draft"),
        tagsJson: data.tagsJson ? String(data.tagsJson) : "[]",
      });
      this.onDomainChanged();
      // Fire document creation automation rules
      this.callbacks.onDocumentCreated(token.companyId, token.agentId, projectId);
      // Wake document reviewer if specified
      if (reviewerAgentId) {
        this.onWakeAgent(reviewerAgentId, token.companyId, "assignment");
      }

      // Deliverable review gate: check at document creation time (most reliable)
      const IMPORTANT_DOC_TYPES = new Set(["prd","technical_spec","design_doc","project_brief","proposal","budget_proposal","architecture_decision","contract","sop"]);
      if (IMPORTANT_DOC_TYPES.has(docType)) {
        try {
          const company = this.db.listSnapshot().companies.find((c) => c.id === token.companyId);
          if (company?.reviewDeliverables) {
            // Check if there's already a pending deliverable_review for this company
            if (!this.db.hasPendingDeliverableReviews(token.companyId)) {
              this.db.requestApproval({
                companyId: token.companyId,
                relatedTaskId: null,
                requestedByAgentId: token.agentId,
                type: "deliverable_review",
                payloadSummary: `Review deliverable: ${docTitle}`.slice(0, 280),
                impactSummary: `New ${docType.replaceAll("_", " ")} created. Awaiting your review before workflow continues.`.slice(0, 400),
                payloadJson: JSON.stringify({ documentIds: [id], documents: [{ id, type: docType, title: docTitle }] }),
              });
              // Pause the producing agent's heartbeat
              try {
                const agent = this.db.getAgent(token.agentId);
                if (agent.heartbeatEnabled) {
                  this.db.setHeartbeat(token.agentId, false, agent.heartbeatIntervalSec || 120);
                }
              } catch { /* best effort */ }
              this.onDomainChanged();
            }
          }
        } catch { /* deliverable review gate is best-effort */ }
      }

      this.json(res, 201, { id });
    });

    this.addRoute("GET", "/api/companies/:companyId/documents", (req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const docs = snapshot.documents.filter(d => d.companyId === token.companyId);
      this.json(res, 200, docs);
    });

    this.addRoute("POST", "/api/companies/:companyId/meetings", (_req, res, params, token, body) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const data = body as Record<string, unknown>;
      const participantAgentIds = data.participantAgentIds ? String(data.participantAgentIds) : "[]";
      try {
        const parsedParticipants = JSON.parse(participantAgentIds) as string[];
        for (const agentId of parsedParticipants) {
          if (typeof agentId !== "string" || !this.db.belongsToCompany("agents", agentId, token.companyId)) {
            this.json(res, 400, { error: "Meeting participants must belong to the current company" });
            return;
          }
        }
      } catch {
        this.json(res, 400, { error: "participantAgentIds must be a JSON array of agent ids" });
        return;
      }
      const id = this.db.saveMeeting({
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
      this.onDomainChanged();
      this.json(res, 201, { id });
    });

    this.addRoute("GET", "/api/companies/:companyId/meetings", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const meetings = snapshot.meetings.filter(m => m.companyId === token.companyId);
      this.json(res, 200, meetings);
    });

    this.addRoute("PATCH", "/api/meetings/:meetingId", (_req, res, params, token, body) => {
      const snapshot = this.db.listSnapshot();
      const existing = snapshot.meetings.find(m => m.id === params.meetingId && m.companyId === token.companyId);
      if (!existing) {
        this.json(res, 404, { error: "Meeting not found" });
        return;
      }
      const data = body as Record<string, unknown>;
      let actionItems: Array<{ title?: string; assigneeAgentId?: string; description?: string }> = [];
      if (data.actionItemsJson) {
        try {
          actionItems = JSON.parse(String(data.actionItemsJson)) as Array<{ title?: string; assigneeAgentId?: string; description?: string }>;
        } catch {
          this.json(res, 400, { error: "actionItemsJson must be valid JSON" });
          return;
        }
        for (const item of actionItems) {
          if (item.assigneeAgentId && !this.db.belongsToCompany("agents", item.assigneeAgentId, token.companyId)) {
            this.json(res, 400, { error: "Meeting action item assignees must belong to the current company" });
            return;
          }
        }
      }
      this.db.saveMeeting({
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
      this.onDomainChanged();
      // When action items are added, create tasks for them automatically
      if (actionItems.length > 0) {
        for (const item of actionItems) {
          if (item.title && typeof item.title === "string") {
            const taskId = this.db.saveTask({
              companyId: token.companyId,
              title: item.title,
              description: item.description ?? `Action item from meeting: ${data.title ?? existing.title}`,
              assigneeAgentId: item.assigneeAgentId ?? null,
              status: item.assigneeAgentId ? "todo" : "backlog",
              priority: "medium",
            });
            if (item.assigneeAgentId) {
              this.onWakeAgent(item.assigneeAgentId, token.companyId, "assignment");
            }
            void taskId;
          }
        }
      }
      this.json(res, 200, { updated: true });
    });

    this.addRoute("POST", "/api/companies/:companyId/knowledge", (_req, res, params, token, body) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const data = body as Record<string, unknown>;
      const id = this.db.saveKnowledgeEntry({
        companyId: token.companyId,
        category: String(data.category ?? "lesson_learned"),
        topic: String(data.topic ?? ""),
        content: String(data.content ?? ""),
        authorAgentId: token.agentId,
        importance: String(data.importance ?? "medium"),
        tagsJson: data.tagsJson ? String(data.tagsJson) : "[]",
        referencedEntityType: data.referencedEntityType ? String(data.referencedEntityType) : null,
        referencedEntityId: data.referencedEntityId ? String(data.referencedEntityId) : null,
      });
      this.onDomainChanged();
      this.json(res, 201, { id });
    });

    this.addRoute("GET", "/api/companies/:companyId/knowledge", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const entries = snapshot.knowledgeBase.filter(k => k.companyId === token.companyId);
      this.json(res, 200, entries);
    });

    this.addRoute("POST", "/api/companies/:companyId/messages", (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }

      const parsed = agentMessageInputSchema.safeParse({
        ...(body as Record<string, unknown>),
        companyId,
        fromAgentId: token.agentId,
      });
      if (!parsed.success) {
        this.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() });
        return;
      }

      const dispatchResult = dispatchAgentMessage(
        {
          db: this.db,
          emitEvent: this.emitEvent,
          publishDomainChanged: this.onDomainChanged,
          wakeAgentIfPossible: (agentId, companyId, trigger) => {
            if (!agentId) return null;
            return this.onWakeAgent(agentId, companyId, trigger);
          },
        },
        parsed.data,
        "message",
      );
      if (!dispatchResult.ok) {
        this.json(res, 400, { error: dispatchResult.error.message, code: dispatchResult.error.code });
        return;
      }

      this.json(res, 201, { id: dispatchResult.data.id });
    });

    this.addRoute("GET", "/api/companies/:companyId/messages", (req, res, params, token) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }

      const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
      const channelParam = url.searchParams.get("channel");
      const channelTargetId = url.searchParams.get("channelTargetId");
      const unreadOnly = url.searchParams.get("unreadOnly") === "true";
      const limitStr = url.searchParams.get("limit");
      const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200) : 50;
      const allowedChannels = new Set(["direct", "department", "company", "project", "incident"]);
      if (channelParam && !allowedChannels.has(channelParam)) {
        this.json(res, 400, { error: `Invalid channel filter: ${channelParam}` });
        return;
      }

      const messages = this.db.listAgentMessages(companyId, {
        agentId: token.agentId,
        channel: channelParam ?? undefined,
        channelTargetId: channelTargetId && channelTargetId.length > 0 ? channelTargetId : undefined,
        unreadOnly,
        limit,
      });
      this.json(res, 200, messages);
    });

    this.addRoute("POST", "/api/companies/:companyId/messages/:messageId/read", (_req, res, params, token) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const message = this.db.getAgentMessage(params.messageId!, companyId);
      if (!message) {
        this.json(res, 404, { error: "Message not found" });
        return;
      }
      const visibleToAgent = this.db.listAgentMessages(companyId, {
        agentId: token.agentId,
        messageId: message.id,
        limit: 1,
      }).some((entry) => entry.id === message.id);
      if (!visibleToAgent) {
        this.json(res, 403, { error: "This message is not visible to the current agent" });
        return;
      }
      this.db.markAgentMessageRead(params.messageId!, companyId, token.agentId);
      this.onDomainChanged();
      this.json(res, 200, { ok: true });
    });

    this.addRoute("GET", "/api/companies/:companyId/sprints", (_req, res, params, token) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const sprints = snapshot.sprints.filter(s => s.companyId === companyId);
      this.json(res, 200, sprints);
    });

    this.addRoute("POST", "/api/companies/:companyId/sprints", (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const data = body as Record<string, unknown>;
      try {
        const id = this.db.saveSprint({
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
        this.onDomainChanged();
        this.json(res, 201, { id });
      } catch {
        this.json(res, 400, { error: "Invalid sprint data" });
      }
    });

    this.addRoute("GET", "/api/agents/:agentId/metrics", (_req, res, params, token) => {
      const snapshot = this.db.listSnapshot();
      const agent = snapshot.agents.find((entry) => entry.id === params.agentId && entry.companyId === token.companyId);
      if (!agent) {
        this.json(res, 404, { error: "Agent not found" });
        return;
      }
      const companyMetrics = this.db.getCompanyMetrics(token.companyId, 30);
      const agentMetric = companyMetrics.agentMetrics.find((metric) => metric.agentId === params.agentId);
      if (!agentMetric) {
        this.json(res, 404, { error: "Metrics not found" });
        return;
      }
      this.json(res, 200, agentMetric);
    });

    this.addRoute("GET", "/api/agents/me/metrics", (_req, res, _params, token) => {
      const companyMetrics = this.db.getCompanyMetrics(token.companyId, 30);
      const agentMetric = companyMetrics.agentMetrics.find(m => m.agentId === token.agentId);
      if (!agentMetric) {
        this.json(res, 404, { error: "Metrics not found" });
        return;
      }
      this.json(res, 200, agentMetric);
    });

    this.addRoute("GET", "/api/agents/:agentId", (_req, res, params, token) => {
      const snapshot = this.db.listSnapshot();
      const agent = snapshot.agents.find(a => a.id === params.agentId && a.companyId === token.companyId);
      if (!agent) {
        this.json(res, 404, { error: "Agent not found" });
        return;
      }
      const directReports = snapshot.agents.filter(a => a.reportsTo === agent.id && a.companyId === token.companyId);
      const manager = agent.reportsTo ? snapshot.agents.find(a => a.id === agent.reportsTo) : null;
      this.json(res, 200, {
        ...agent,
        manager: manager ? { id: manager.id, name: manager.name, role: manager.role } : null,
        directReports: directReports.map(r => ({ id: r.id, name: r.name, role: r.role, status: r.status })),
      });
    });

    this.addRoute("POST", "/api/agents/:agentId/wake", (_req, res, params, token, body) => {
      const targetAgentId = params.agentId!;
      const targetAgent = (() => {
        try {
          return this.db.getAgent(targetAgentId);
        } catch {
          return null;
        }
      })();
      if (!targetAgent || targetAgent.companyId !== token.companyId) {
        this.json(res, 404, { error: "Agent not found" });
        return;
      }
      if (!canControlAgent(this.db, token.companyId, token.agentId, targetAgentId)) {
        this.json(res, 403, { error: "Current agent is not allowed to wake this agent" });
        return;
      }
      const wakeSchema = z.object({
        reason: z.string().min(1).max(200).default("peer_request"),
      });
      const parsed = wakeSchema.safeParse(body);
      const reason = parsed.success ? parsed.data.reason : "peer_request";
      const alreadyActive = this.db.hasActiveRun({ companyId: token.companyId, agentId: targetAgentId });
      const runId = this.onWakeAgent(targetAgentId, token.companyId, reason);
      if (runId) {
        this.json(res, 200, { ok: true, runId, message: `Wake started for agent ${targetAgentId}` });
        return;
      }
      if (alreadyActive) {
        this.json(res, 202, {
          ok: true,
          queued: true,
          message: `Agent ${targetAgentId} is already running. Wake will be retried after the active run completes.`,
        });
        return;
      }
      this.json(res, 409, { ok: false, error: "Agent could not be woken right now" });
    });

    this.addRoute("PATCH", "/api/agents/:agentId/heartbeat", (_req, res, params, token) => {
      const targetAgentId = params.agentId!;
      const snapshot = this.db.listSnapshot();
      const targetAgent = snapshot.agents.find(
        (a) => a.id === targetAgentId && a.companyId === token.companyId,
      );
      if (!targetAgent) {
        this.json(res, 404, { error: "Agent not found or not in the same company" });
        return;
      }
      if (!canControlAgent(this.db, token.companyId, token.agentId, targetAgentId)) {
        this.json(res, 403, { error: "Current agent is not allowed to trigger heartbeat for this agent" });
        return;
      }
      const alreadyActive = this.db.hasActiveRun({ companyId: token.companyId, agentId: targetAgentId });
      const runId = this.onWakeAgent(targetAgentId, token.companyId, "peer_request");
      if (runId) {
        this.json(res, 200, { ok: true, runId, message: `Heartbeat triggered for agent ${targetAgentId}` });
        return;
      }
      if (alreadyActive) {
        this.json(res, 202, {
          ok: true,
          queued: true,
          message: `Agent ${targetAgentId} is already running. Heartbeat will retry after the current run.`,
        });
        return;
      }
      this.json(res, 409, { ok: false, error: "Heartbeat could not be started for this agent" });
    });

    this.addRoute("GET", "/api/companies/:companyId/dashboard", (_req, res, params, token) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
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

      this.json(res, 200, {
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
}
