import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import log from "electron-log/main.js";
import { validateAgentToken, type TokenPayload } from "../agent-auth";
import type { AppDatabase } from "../database";
import type { DesktopEvent, SectionId } from "@shared/types";

/**
 * Decode an HTTP request body to a UTF-8 string, handling the common Windows
 * encoding issue where Chinese/CJK characters arrive in GBK (CP936) instead
 * of UTF-8. On Chinese Windows the system ANSI code page is GBK; tools like
 * curl encode command-line arguments using that code page when stdout is piped
 * (chcp 65001 does not help because there is no real console). We try strict
 * UTF-8 first and, only if the bytes are invalid UTF-8, fall back to GBK.
 */
export function decodeBodyToUtf8(raw: Buffer): string {
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

export type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  token: TokenPayload,
  body: unknown,
) => void | Promise<void>;

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RequestHandler;
}

export interface ApiServerEventCallbacks {
  onDomainChanged: () => void;
  onWakeAgent: (agentId: string, companyId: string, trigger: string) => string | null;
  onTaskCreated: (taskId: string, companyId: string) => void;
  onTaskStatusChanged: (taskId: string, companyId: string, previousStatus: string, newStatus: string) => void;
  onCommentPosted: (taskId: string, companyId: string, authorAgentId: string | null) => void;
  onApprovalCreated: (approvalId: string, companyId: string, taskId: string | null, approvalType: string, summary: string) => void;
  onApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
  onDocumentCreated: (companyId: string, authorAgentId: string | null, projectId: string | null, documentId: string, documentTitle: string, documentType: string, taskId: string | null) => void;
  onAutoAssignTask: (taskId: string, companyId: string) => string | null;
  onHumanMessage: (companyId: string, toAgentId?: string | null, threadId?: string | null, waitStateId?: string | null) => void;
  emitEvent: (event: DesktopEvent) => void;
  notify: (options: { title: string; body: string; urgency: "critical" | "informational"; navigation?: { section: SectionId; entityId?: string }; batchKey?: string }) => void;
}

export class AgentApiServer {
  private routes: Route[] = [];
  private server: ReturnType<typeof createServer> | null = null;
  private port = 0;
  private db: AppDatabase;
  private onDomainChangedCb: () => void;
  private onWakeAgentCb: (agentId: string, companyId: string, trigger: string) => string | null;
  private emitEventCb: (event: DesktopEvent) => void;
  private callbacks: ApiServerEventCallbacks;
  private allowedOrigins: Set<string>;
  private onBrowserActionCb: ((actionId: string, companyId: string) => void) | null = null;

  constructor(
    db: AppDatabase,
    onDomainChanged: () => void,
    onWakeAgent: (agentId: string, companyId: string, trigger: string) => string | null,
    callbacks?: Partial<ApiServerEventCallbacks>,
    allowedOrigins: Iterable<string> = ["app://-"],
  ) {
    this.db = db;
    this.onDomainChangedCb = onDomainChanged;
    this.onWakeAgentCb = onWakeAgent;
    this.emitEventCb = callbacks?.emitEvent ?? (() => {});
    this.allowedOrigins = new Set(Array.from(allowedOrigins).filter(Boolean));
    this.callbacks = {
      onDomainChanged,
      onWakeAgent,
      onTaskCreated: callbacks?.onTaskCreated ?? (() => {}),
      onTaskStatusChanged: callbacks?.onTaskStatusChanged ?? (() => {}),
      onCommentPosted: callbacks?.onCommentPosted ?? (() => {}),
      onApprovalCreated: callbacks?.onApprovalCreated ?? (() => {}),
      onApprovalResolved: callbacks?.onApprovalResolved ?? (() => {}),
      onDocumentCreated: callbacks?.onDocumentCreated ?? (() => {}),
      onAutoAssignTask: callbacks?.onAutoAssignTask ?? (() => null),
      onHumanMessage: callbacks?.onHumanMessage ?? (() => {}),
      emitEvent: callbacks?.emitEvent ?? (() => {}),
      notify: callbacks?.notify ?? (() => {}),
    };
  }

  setBrowserActionHandler(handler: (actionId: string, companyId: string) => void) {
    this.onBrowserActionCb = handler;
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

  addRoute(method: string, path: string, handler: RequestHandler) {
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

  json(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  }

  companyRefError(
    res: ServerResponse,
    companyId: string,
    refs: Array<{ id: string | null | undefined; table: "agents" | "goals" | "projects" | "tasks" | "workspaces" | "approvals"; label: string }>,
  ) {
    const invalid = refs.find((ref) => ref.id && !this.db.belongsToCompany(ref.table, ref.id, companyId));
    if (!invalid) return false;
    this.json(res, 422, { error: `${invalid.label} does not belong to the current company` });
    return true;
  }

  // Accessors for route registrars
  get db_(): AppDatabase { return this.db; }
  get callbacks_(): ApiServerEventCallbacks { return this.callbacks; }
  get onDomainChanged_(): () => void { return this.onDomainChangedCb; }
  get onWakeAgent_(): (agentId: string, companyId: string, trigger: string) => string | null { return this.onWakeAgentCb; }
  get emitEvent_(): (event: DesktopEvent) => void { return this.emitEventCb; }
  get onBrowserAction_(): ((actionId: string, companyId: string) => void) | null {
    return this.onBrowserActionCb;
  }
  get port_(): number { return this.port; }
}
