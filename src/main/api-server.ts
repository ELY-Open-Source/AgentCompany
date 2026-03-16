import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import log from "electron-log/main.js";
import { z } from "zod";
import { validateAgentToken, type TokenPayload } from "./agent-auth";
import type { AppDatabase } from "./database";
import { agentInputSchema, approvalInputSchema, goalInputSchema, projectInputSchema, taskInputSchema } from "@shared/contracts";

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
});

const checkoutSchema = z.object({
  agentId: z.string().uuid().optional(),
});

const approvalListQuerySchema = z.object({
  requestedByAgentId: z.string().uuid().optional(),
  relatedTaskId: z.string().uuid().optional(),
  status: z.string().optional(),
});

/**
 * Lightweight local HTTP API server for agent-to-system interaction.
 * Agents call this API during runs to create tasks, request approvals,
 * post comments, and query their assignments.
 */
export class AgentApiServer {
  private routes: Route[] = [];
  private server: ReturnType<typeof createServer> | null = null;
  private port = 0;
  private db: AppDatabase;
  private onDomainChanged: () => void;
  private onWakeAgent: (agentId: string, companyId: string, trigger: string) => void;
  private onBrowserAction: ((actionId: string, socialAccountId: string, actionType: string, payload: Record<string, unknown>) => void) | null = null;

  constructor(db: AppDatabase, onDomainChanged: () => void, onWakeAgent: (agentId: string, companyId: string, trigger: string) => void) {
    this.db = db;
    this.onDomainChanged = onDomainChanged;
    this.onWakeAgent = onWakeAgent;
    this.registerRoutes();
  }

  setBrowserActionHandler(handler: (actionId: string, socialAccountId: string, actionType: string, payload: Record<string, unknown>) => void) {
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
      const allowedOrigin =
        origin === "app://-" ||
        origin.startsWith("http://127.0.0.1:") ||
        origin.startsWith("http://localhost:");
      if (!allowedOrigin) {
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

    // Parse URL
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    // Auth
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

    // Bind token to its run — verify the run exists and belongs to the token's company
    if (!this.db.belongsToCompany("runs", token.runId, token.companyId)) {
      this.json(res, 403, { error: "Token references an unknown or mismatched run" });
      return;
    }

    // Match route
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1]!;
      });

      // Parse body for POST/PATCH/PUT
      let body: unknown = null;
      if (["POST", "PATCH", "PUT"].includes(method)) {
        try {
          body = await this.readBody(req);
        } catch {
          this.json(res, 400, { error: "Invalid JSON body" });
          return;
        }
      }

      try {
        await route.handler(req, res, params, token, body);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[api] ${method} ${pathname}: ${message}`);
        this.json(res, 500, { error: message });
      }
      return;
    }

    this.json(res, 404, { error: "Not found" });
  }

  private readBody(req: IncomingMessage): Promise<unknown> {
    const MAX_BODY_BYTES = 1_048_576; // 1 MB
    return new Promise((resolve, reject) => {
      let data = "";
      let bytes = 0;
      req.on("data", (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_BODY_BYTES) {
          req.destroy();
          reject(new Error("Request body too large"));
          return;
        }
        data += String(chunk);
      });
      req.on("end", () => {
        try { resolve(data ? JSON.parse(data) : null); }
        catch { reject(new Error("Invalid JSON")); }
      });
      req.on("error", reject);
    });
  }

  private json(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
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
    // GET /api/agents/me — Agent identity
    this.addRoute("GET", "/api/agents/me", (_req, res, _params, token) => {
      const agent = this.db.getAgent(token.agentId);
      const chainOfCommand = this.db.getChainOfCommand(token.agentId);
      const directReports = this.db.getDirectReports(token.agentId, token.companyId);
      this.json(res, 200, { agent, chainOfCommand, directReports });
    });

    // GET /api/companies/:companyId/issues — List issues with filters
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
        // Return all company tasks with the given statuses
        const snapshot = this.db.listSnapshot();
        const tasks = snapshot.tasks.filter((t) => t.companyId === companyId && statuses.includes(t.status));
        this.json(res, 200, tasks);
      }
    });

    // GET /api/issues/:issueId — Get single issue
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

    // POST /api/issues/:issueId/checkout — Claim a task
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
      const success = this.db.checkoutTask(params.issueId!, agentId);
      if (!success) {
        this.json(res, 409, { error: "Task cannot be checked out — already assigned or not in valid status" });
        return;
      }
      this.onDomainChanged();
      this.json(res, 200, { ok: true });
    });

    // PATCH /api/issues/:issueId — Update task
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

        // Update fields
        const input: Record<string, unknown> = {
          id: task.id,
          companyId: task.companyId,
          title: update.title ?? task.title,
          description: update.description ?? task.description,
          status: update.status ?? task.status,
          priority: task.priority,
          projectId: task.projectId,
          goalId: task.goalId,
          parentId: task.parentId,
          assigneeAgentId: task.assigneeAgentId,
          workspaceId: task.workspaceId,
        };
        this.db.saveTask(input as Parameters<typeof this.db.saveTask>[0]);

        // Add comment if provided
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

        // Step 5a: Wake propagation on task status change
        // Completion notification → task tree (parentId → parent assignee)
        if (update.status && ["done", "in_review"].includes(update.status)) {
          if (task.parentId) {
            try {
              const parentTask = this.db.getTask(task.parentId);
              if (parentTask.assigneeAgentId && parentTask.assigneeAgentId !== token.agentId) {
                this.onWakeAgent(parentTask.assigneeAgentId, task.companyId, "subtask_completed");
              }
            } catch { /* parent task may have been deleted */ }
          } else {
            // Root task (no parent) — fall back to org hierarchy to notify manager
            const chain = this.db.getChainOfCommand(token.agentId);
            if (chain.length > 0) {
              this.onWakeAgent(chain[0].id, task.companyId, "subtask_completed");
            }
          }
        }

        // Blocked escalation → org hierarchy (agent's manager)
        if (update.status === "blocked") {
          const chain = this.db.getChainOfCommand(token.agentId);
          if (chain.length > 0) {
            this.onWakeAgent(chain[0].id, task.companyId, "report_blocked");
          }
        }

        // Review feedback: when a non-assignee (manager) changes status back to
        // in_progress or todo, wake the assignee so they know to address feedback
        if (update.status && ["in_progress", "todo"].includes(update.status) &&
            task.assigneeAgentId && task.assigneeAgentId !== token.agentId) {
          this.onWakeAgent(task.assigneeAgentId, task.companyId, "assignment");
        }

        // Comment with status change → wake assignee + manager for the comment
        // Comment-only PATCH (no status change) → also wake assignee + manager
        if (update.comment) {
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

        this.json(res, 200, { ok: true });
      } catch (error) {
        if (error instanceof Error && error.message.includes("require an assignee")) {
          this.json(res, 422, { error: error.message });
          return;
        }
        this.json(res, 404, { error: "Task not found" });
      }
    });

    // POST /api/companies/:companyId/issues — Create task/subtask
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

      this.db.addActivity({
        companyId,
        actor: token.agentId,
        action: "task.created",
        entityType: "task",
        entityId: id,
        detail: input.title,
      });

      this.onDomainChanged();

      // Auto-cascade: when a task is assigned to an agent, enable their heartbeat and wake them
      if (input.assigneeAgentId && input.assigneeAgentId !== token.agentId) {
        try {
          const assignee = this.db.getAgent(input.assigneeAgentId);
          if (!assignee.heartbeatEnabled) {
            this.db.setHeartbeat(input.assigneeAgentId, true, assignee.heartbeatIntervalSec || 120);
          }
          this.onWakeAgent(input.assigneeAgentId, companyId, "assignment");
        } catch { /* ignore if agent not found */ }
      }

      this.json(res, 201, { id });
    });

    // POST /api/companies/:companyId/projects — Create project
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
        try {
          const lead = this.db.getAgent(input.leadAgentId);
          if (!lead.heartbeatEnabled) {
            this.db.setHeartbeat(input.leadAgentId, true, lead.heartbeatIntervalSec || 120);
          }
          this.onWakeAgent(input.leadAgentId, companyId, "assignment");
        } catch {
          // Ignore missing lead agents after validation drift.
        }
      }
      this.json(res, 201, { id });
    });

    // POST /api/companies/:companyId/goals — Create goal
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
        try {
          const owner = this.db.getAgent(input.ownerAgentId);
          if (!owner.heartbeatEnabled) {
            this.db.setHeartbeat(input.ownerAgentId, true, owner.heartbeatIntervalSec || 120);
          }
          this.onWakeAgent(input.ownerAgentId, companyId, "goal_activated");
        } catch {
          // Ignore missing owner agents after validation drift.
        }
      }
      this.json(res, 201, { id });
    });

    // POST /api/companies/:companyId/agents — Propose a hire
    this.addRoute("POST", "/api/companies/:companyId/agents", (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const parsed = agentInputSchema.safeParse({
        companyId,
        status: "pending_approval",
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
        { id: input.reportsTo, table: "agents", label: "manager" },
        { id: input.workspaceId, table: "workspaces", label: "workspace" },
      ])) {
        return;
      }

      let agentId: string;
      try {
        agentId = this.db.saveAgent({
          id: input.id ?? null,
          companyId,
          name: input.name,
          role: input.role,
          title: input.title,
          status: "pending_approval",
          reportsTo: input.reportsTo ?? token.agentId,
          connectorId: input.connectorId,
          workspaceId: input.workspaceId ?? null,
          model: input.model ?? null,
          metadataJson: input.metadataJson,
          capabilities: input.capabilities,
          budgetMonthlyUsd: input.budgetMonthlyUsd,
        });
      } catch (error) {
        this.json(res, 422, { error: error instanceof Error ? error.message : "Hire could not be created" });
        return;
      }

      const approvalId = this.db.requestApproval({
        companyId,
        requestedByAgentId: token.agentId,
        type: "hire_agent",
        payloadSummary: `Hire ${input.name} as ${input.role}`,
        impactSummary: input.capabilities || `${input.name} will report to ${input.reportsTo ?? token.agentId}.`,
        payloadJson: JSON.stringify({
          agentId,
          requestedByAgentId: token.agentId,
          requestedConfigurationSnapshot: {
            connectorId: input.connectorId,
            workspaceId: input.workspaceId ?? null,
            model: input.model ?? null,
            metadataJson: input.metadataJson,
            capabilities: input.capabilities,
            budgetMonthlyUsd: input.budgetMonthlyUsd,
            reportsTo: input.reportsTo ?? token.agentId,
          },
        }),
      });

      this.db.addActivity({
        companyId,
        actor: token.agentId,
        action: "agent.hire_requested",
        entityType: "agent",
        entityId: agentId,
        detail: input.name,
      });
      this.onDomainChanged();
      this.json(res, 201, { agentId, approvalId });
    });

    // POST /api/issues/:issueId/comments — Add comment
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

        // Step 5b: Wake task assignee (if not the comment author)
        const wokenForComment = new Set<string>();
        if (task.assigneeAgentId && task.assigneeAgentId !== token.agentId) {
          this.onWakeAgent(task.assigneeAgentId, task.companyId, "comment");
          wokenForComment.add(task.assigneeAgentId);
        }

        // Wake comment author's manager (org hierarchy — for upward reporting chain)
        const chain = this.db.getChainOfCommand(token.agentId);
        if (chain.length > 0 && chain[0].id !== token.agentId && !wokenForComment.has(chain[0].id)) {
          this.onWakeAgent(chain[0].id, task.companyId, "comment");
        }

        this.json(res, 201, comment);
      } catch {
        this.json(res, 404, { error: "Task not found" });
      }
    });

    // GET /api/issues/:issueId/comments — List comments
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

    // POST /api/companies/:companyId/approvals — Request approval
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
      ])) {
        return;
      }

      const id = this.db.requestApproval({
        companyId,
        type: input.type,
        relatedTaskId: input.relatedTaskId ?? null,
        requestedByAgentId: token.agentId,
        payloadSummary: input.payloadSummary,
        impactSummary: input.impactSummary,
      });

      this.db.addActivity({
        companyId,
        actor: token.agentId,
        action: "approval.created",
        entityType: "approval",
        entityId: id,
        detail: input.payloadSummary,
      });

      // Auto-approve hire requests if company has auto_approve_hires enabled
      const snapshot = this.db.listSnapshot();
      const company = snapshot.companies.find((c) => c.id === companyId);
      if (company?.autoApproveHires && (input.type === "hire_agent" || input.type === "approve_ceo_strategy")) {
        this.db.decideApproval({ approvalId: id, state: "approved", decisionNote: "Auto-approved by company policy" });
        this.db.addActivity({
          companyId,
          actor: "board",
          action: "approval.approved",
          entityType: "approval",
          entityId: id,
          detail: "Auto-approved by company policy",
        });
        // Wake the requesting agent so they know the hire was approved
        this.onWakeAgent(token.agentId, companyId, "approval_resolved");
        // Wake the newly hired agent
        try {
          const fullApproval = this.db.getApprovalRecord(id);
          const payload = JSON.parse(fullApproval.payloadJson || "{}") as { agentId?: string };
          if (payload.agentId) {
            this.onWakeAgent(payload.agentId, companyId, "assignment");
          }
        } catch { /* ignore if payload is malformed */ }
        log.info(`[auto-approve] Auto-approved hire request: ${input.payloadSummary}`);
      }

      this.onDomainChanged();
      this.json(res, 201, { id });
    });

    // GET /api/companies/:companyId/approvals — List approvals for polling
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

    // GET /api/approvals/:approvalId — Get approval
    this.addRoute("GET", "/api/approvals/:approvalId", (_req, res, params, token) => {
      const snapshot = this.db.listSnapshot();
      const approval = snapshot.approvals.find((a) => a.id === params.approvalId && a.companyId === token.companyId);
      if (!approval) {
        this.json(res, 404, { error: "Approval not found" });
        return;
      }
      this.json(res, 200, approval);
    });

    // GET /api/companies/:companyId/agents — List agents
    this.addRoute("GET", "/api/companies/:companyId/agents", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const agents = snapshot.agents.filter((a) => a.companyId === params.companyId);
      this.json(res, 200, agents);
    });

    // GET /api/companies/:companyId/goals — List goals
    this.addRoute("GET", "/api/companies/:companyId/goals", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const goals = snapshot.goals.filter((g) => g.companyId === params.companyId);
      this.json(res, 200, goals);
    });

    // GET /api/companies/:companyId/projects — List projects
    this.addRoute("GET", "/api/companies/:companyId/projects", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const projects = snapshot.projects.filter((p) => p.companyId === params.companyId);
      this.json(res, 200, projects);
    });

    // GET /api/agents/me/standup — Standup summary for the current agent
    // Returns a comprehensive view of the agent's team status, pending reviews,
    // blocked tasks, and recent activity — like a daily standup briefing.
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

      // Recent activity: comments on my tasks in last 2 hours
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const recentComments = snapshot.comments
        .filter((c) => {
          const isMyTask = myTasks.some((t) => t.id === c.taskId);
          const isReportTask = reportTasks.some((t) => t.id === c.taskId);
          return (isMyTask || isReportTask) && new Date(c.createdAt).getTime() > twoHoursAgo;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 20);

      // Pending approvals I requested
      const myPendingApprovals = snapshot.approvals.filter(
        (a) => a.requestedByAgentId === token.agentId && a.state === "pending" && a.companyId === token.companyId,
      );
      // Recently resolved approvals
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

    // ── Browser Automation API (for agents) ────────────────────────────

    // POST /api/companies/:companyId/browser/action — Submit a browser action
    this.addRoute("POST", "/api/companies/:companyId/browser/action", async (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }

      const actionSchema = z.object({
        socialAccountId: z.string().uuid(),
        actionType: z.enum(["post", "reply", "like", "follow", "browse_feed", "screenshot", "navigate", "search", "dm", "custom_script"]),
        payload: z.record(z.string(), z.unknown()).default({}),
      });

      const parsed = actionSchema.safeParse(body);
      if (!parsed.success) {
        this.json(res, 400, { error: "Invalid browser action payload", details: parsed.error.issues });
        return;
      }

      const input = parsed.data;

      // Verify the social account belongs to this company
      const snapshot = this.db.listSnapshot();
      const account = snapshot.socialAccounts.find(a => a.id === input.socialAccountId && a.companyId === companyId);
      if (!account) {
        this.json(res, 404, { error: "Social account not found" });
        return;
      }

      // Check if approval is required for posting actions
      const postActions = ["post", "reply", "dm"];
      if (account.requireApproval && postActions.includes(input.actionType)) {
        // Create an approval request
        const approvalId = this.db.requestApproval({
          companyId,
          type: "dangerous_command",
          relatedTaskId: null,
          requestedByAgentId: token.agentId,
          payloadSummary: `${input.actionType} on ${account.platform}/@${account.accountName}: ${String(input.payload.content || "").slice(0, 100)}`,
          impactSummary: `Will ${input.actionType} on ${account.displayName || account.accountName}'s ${account.platform} account. Content will be publicly visible.`,
        });

        // Save the action in approval_required state
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

      // Save the action
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

      // Execute the action asynchronously via the browser manager callback
      if (this.onBrowserAction) {
        this.onBrowserAction(actionId, input.socialAccountId, input.actionType, input.payload as Record<string, unknown>);
      }

      this.json(res, 201, { id: actionId, status: "queued", message: "Browser action queued for execution" });
    });

    // GET /api/companies/:companyId/social-accounts — List social accounts
    this.addRoute("GET", "/api/companies/:companyId/social-accounts", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const accounts = this.db.listSocialAccounts(params.companyId!);
      // Don't expose credential secret IDs to agents
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

    // GET /api/companies/:companyId/browser/actions — List browser action history
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

    // ── Documents API ─────────────────────────────────────────────────

    // POST /api/companies/:companyId/documents — Create a document
    this.addRoute("POST", "/api/companies/:companyId/documents", (_req, res, params, token, body) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const data = body as Record<string, unknown>;
      const id = this.db.saveDocument({
        companyId: token.companyId,
        type: String(data.type ?? "knowledge_article"),
        title: String(data.title ?? "Untitled"),
        content: String(data.content ?? ""),
        authorAgentId: token.agentId,
        reviewerAgentId: data.reviewerAgentId ? String(data.reviewerAgentId) : null,
        projectId: data.projectId ? String(data.projectId) : null,
        goalId: data.goalId ? String(data.goalId) : null,
        status: String(data.status ?? "draft"),
        tagsJson: data.tagsJson ? String(data.tagsJson) : "[]",
      });
      this.onDomainChanged();
      this.json(res, 201, { id });
    });

    // GET /api/companies/:companyId/documents — List documents
    this.addRoute("GET", "/api/companies/:companyId/documents", (req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const docs = snapshot.documents.filter(d => d.companyId === token.companyId);
      this.json(res, 200, docs);
    });

    // ── Meetings API ──────────────────────────────────────────────────

    // POST /api/companies/:companyId/meetings — Schedule a meeting
    this.addRoute("POST", "/api/companies/:companyId/meetings", (_req, res, params, token, body) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const data = body as Record<string, unknown>;
      const id = this.db.saveMeeting({
        companyId: token.companyId,
        type: String(data.type ?? "department_sync"),
        title: String(data.title ?? "Meeting"),
        organizerAgentId: token.agentId,
        participantAgentIds: data.participantAgentIds ? String(data.participantAgentIds) : "[]",
        scheduledAt: String(data.scheduledAt ?? new Date().toISOString()),
        durationMinutes: Number(data.durationMinutes ?? 30),
        agendaJson: data.agendaJson ? String(data.agendaJson) : "[]",
        status: "scheduled",
      });
      this.onDomainChanged();
      this.json(res, 201, { id });
    });

    // GET /api/companies/:companyId/meetings — List meetings
    this.addRoute("GET", "/api/companies/:companyId/meetings", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const meetings = snapshot.meetings.filter(m => m.companyId === token.companyId);
      this.json(res, 200, meetings);
    });

    // PATCH /api/meetings/:meetingId — Update meeting (add notes, decisions, etc.)
    this.addRoute("PATCH", "/api/meetings/:meetingId", (_req, res, params, token, body) => {
      const data = body as Record<string, unknown>;
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
      this.json(res, 200, { updated: true });
    });

    // ── Knowledge Base API ────────────────────────────────────────────

    // POST /api/companies/:companyId/knowledge — Add knowledge entry
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

    // GET /api/companies/:companyId/knowledge — List knowledge entries
    this.addRoute("GET", "/api/companies/:companyId/knowledge", (_req, res, params, token) => {
      if (params.companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      const snapshot = this.db.listSnapshot();
      const entries = snapshot.knowledgeBase.filter(k => k.companyId === token.companyId);
      this.json(res, 200, entries);
    });

    // ── Agent Messaging API ──────────────────────────────────────────────

    // POST /api/companies/:companyId/messages — Send a message to another agent
    this.addRoute("POST", "/api/companies/:companyId/messages", (_req, res, params, token, body) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }

      const messageSchema = z.object({
        toAgentId: z.string().uuid().nullable().optional(),
        channel: z.enum(["direct", "department", "company", "project", "incident"]).default("direct"),
        channelTargetId: z.string().nullable().optional(),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(8000),
        priority: z.enum(["urgent", "normal", "low"]).default("normal"),
        parentMessageId: z.string().uuid().nullable().optional(),
        attachmentsJson: z.string().default("[]"),
      });

      const parsed = messageSchema.safeParse(body);
      if (!parsed.success) {
        this.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() });
        return;
      }

      const msg = parsed.data;
      const messageId = this.db.sendAgentMessage({
        companyId,
        fromAgentId: token.agentId,
        toAgentId: msg.toAgentId,
        channel: msg.channel,
        channelTargetId: msg.channelTargetId,
        subject: msg.subject,
        body: msg.body,
        priority: msg.priority,
        parentMessageId: msg.parentMessageId,
        attachmentsJson: msg.attachmentsJson,
      });

      // Wake the recipient if it's a direct message
      if (msg.toAgentId && msg.channel === "direct") {
        this.onWakeAgent(msg.toAgentId, companyId, "message");
      }

      // Wake all agents in the department if it's a department broadcast
      if (msg.channel === "department" && msg.channelTargetId) {
        const snapshot = this.db.listSnapshot();
        const deptAgents = snapshot.agents.filter(
          (a) => a.department === msg.channelTargetId && a.companyId === companyId && a.id !== token.agentId && a.status !== "terminated",
        );
        for (const a of deptAgents) {
          this.onWakeAgent(a.id, companyId, "message");
        }
      }

      this.onDomainChanged();
      this.json(res, 201, { id: messageId });
    });

    // GET /api/companies/:companyId/messages — List messages for the calling agent
    this.addRoute("GET", "/api/companies/:companyId/messages", (req, res, params, token) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }

      const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
      const channel = url.searchParams.get("channel") ?? undefined;
      const unreadOnly = url.searchParams.get("unreadOnly") === "true";
      const limitStr = url.searchParams.get("limit");
      const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200) : 50;

      const messages = this.db.listAgentMessages(companyId, {
        agentId: token.agentId,
        channel,
        unreadOnly,
        limit,
      });
      this.json(res, 200, messages);
    });

    // POST /api/companies/:companyId/messages/:messageId/read — Mark message as read
    this.addRoute("POST", "/api/companies/:companyId/messages/:messageId/read", (_req, res, params, token) => {
      const companyId = params.companyId!;
      if (companyId !== token.companyId) {
        this.json(res, 403, { error: "Company mismatch" });
        return;
      }
      this.db.markMessageRead(params.messageId!, companyId);
      this.json(res, 200, { ok: true });
    });

    // ── Sprint API ───────────────────────────────────────────────────────

    // GET /api/companies/:companyId/sprints — List sprints
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

    // ── Performance Metrics API ──────────────────────────────────────────

    // GET /api/agents/me/metrics — Get the calling agent's performance metrics
    this.addRoute("GET", "/api/agents/me/metrics", (_req, res, _params, token) => {
      const companyMetrics = this.db.getCompanyMetrics(token.companyId, 30);
      const agentMetric = companyMetrics.agentMetrics.find(m => m.agentId === token.agentId);
      if (!agentMetric) {
        this.json(res, 404, { error: "Metrics not found" });
        return;
      }
      this.json(res, 200, agentMetric);
    });

    // ── Org Chart / Agent Details API ────────────────────────────────────

    // GET /api/agents/:agentId — Get a specific agent's details
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

    // ── Wake / Heartbeat API ─────────────────────────────────────────────

    // POST /api/agents/:agentId/wake — Request to wake another agent
    this.addRoute("POST", "/api/agents/:agentId/wake", (_req, res, params, token, body) => {
      const targetAgentId = params.agentId!;
      const wakeSchema = z.object({
        reason: z.string().min(1).max(200).default("peer_request"),
      });
      const parsed = wakeSchema.safeParse(body);
      const reason = parsed.success ? parsed.data.reason : "peer_request";
      this.onWakeAgent(targetAgentId, token.companyId, reason);
      this.json(res, 200, { ok: true, message: `Wake requested for agent ${targetAgentId}` });
    });
  }
}
