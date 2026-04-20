import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import log from "electron-log/main.js";
import { validateAgentToken, type TokenPayload } from "../agent-auth";
import type { AppDatabase } from "../database";
import type { AgentMessageRecord, DesktopEvent, SectionId } from "@shared/types";
import type { DocumentLifecycleInput, DocumentLifecycleOutcome } from "../document-lifecycle";

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

/**
 * Extract a required route parameter or throw a 400-level error.
 * The HTTP router guarantees all named params are present when a route
 * matches, but TypeScript cannot prove this statically.
 */
export function requireParam(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (value === undefined) throw Object.assign(new Error(`Missing route parameter: ${name}`), { statusCode: 400 });
  return value;
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
  /**
   * Persist a document through the shared `document-lifecycle` pipeline.
   * Collapses the two previous entry points (this HTTP route and the
   * desktop IPC handler) onto a single fan-out so thread, checkpoint,
   * automation, and deliverable-review side effects land consistently
   * regardless of which surface authored the write.
   */
  createDocument: (input: DocumentLifecycleInput) => DocumentLifecycleOutcome;
  onAutoAssignTask: (taskId: string, companyId: string) => string | null;
  onHumanMessage: (companyId: string, toAgentId?: string | null, threadId?: string | null, waitStateId?: string | null) => void;
  /**
   * Tries to hand a freshly persisted message to the recipient's live
   * pi run via the runtime steer channel. Returns true when the worker
   * accepted the steer; dispatch should then skip the regular wake
   * pipeline for this recipient.
   */
  injectRuntimeMessage: (recipientAgentId: string, companyId: string, message: AgentMessageRecord) => boolean;
  emitEvent: (event: DesktopEvent) => void;
  notify: (options: { title: string; body: string; urgency: "critical" | "informational"; navigation?: { section: SectionId; entityId?: string }; batchKey?: string }) => void;
}

/**
 * Token-bucket rate limiter scoped per (companyId, agentId).
 *
 * An agent that exceeds the burst capacity (`maxTokens`) is rejected with 429
 * until enough wall-clock time has passed for the bucket to refill at
 * `refillRatePerSec` tokens/second. The bucket is in-memory and resets on
 * process restart — agents misbehaving across restarts are detected at the
 * next bucket; this is a defence against runaway loops, not a quota system.
 */
class AgentRateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefillMs: number }>();
  private readonly maxTokens: number;
  private readonly refillRatePerSec: number;

  constructor(opts: { maxTokens: number; refillRatePerSec: number }) {
    this.maxTokens = opts.maxTokens;
    this.refillRatePerSec = opts.refillRatePerSec;
  }

  /** Returns retry-after seconds when blocked, or `null` to allow. */
  consume(key: string): number | null {
    const now = Date.now();
    const existing = this.buckets.get(key);
    const bucket = existing ?? { tokens: this.maxTokens, lastRefillMs: now };
    if (existing) {
      const elapsedSec = (now - existing.lastRefillMs) / 1000;
      bucket.tokens = Math.min(this.maxTokens, existing.tokens + elapsedSec * this.refillRatePerSec);
      bucket.lastRefillMs = now;
    }
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      const tokensShort = 1 - bucket.tokens;
      return Math.max(1, Math.ceil(tokensShort / this.refillRatePerSec));
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return null;
  }
}

export class AgentApiServer {
  private _routes: Route[] = [];
  private _server: ReturnType<typeof createServer> | null = null;
  private _port = 0;
  private _db: AppDatabase;
  private _onDomainChangedCb: () => void;
  private _onWakeAgentCb: (agentId: string, companyId: string, trigger: string) => string | null;
  private _emitEventCb: (event: DesktopEvent) => void;
  private _callbacks: ApiServerEventCallbacks;
  private _allowedOrigins: Set<string>;
  private _onBrowserActionCb: ((actionId: string, companyId: string) => void) | null = null;
  /** 60 req/min sustained, 30 req burst per (companyId, agentId). */
  private _rateLimiter = new AgentRateLimiter({ maxTokens: 30, refillRatePerSec: 1 });

  constructor(
    db: AppDatabase,
    onDomainChanged: () => void,
    onWakeAgent: (agentId: string, companyId: string, trigger: string) => string | null,
    callbacks?: Partial<ApiServerEventCallbacks>,
    allowedOrigins: Iterable<string> = ["app://-"],
  ) {
    this._db = db;
    this._onDomainChangedCb = onDomainChanged;
    this._onWakeAgentCb = onWakeAgent;
    this._emitEventCb = callbacks?.emitEvent ?? (() => {});
    this._allowedOrigins = new Set(Array.from(allowedOrigins).filter(Boolean));
    this._callbacks = {
      onDomainChanged,
      onWakeAgent,
      onTaskCreated: callbacks?.onTaskCreated ?? (() => {}),
      onTaskStatusChanged: callbacks?.onTaskStatusChanged ?? (() => {}),
      onCommentPosted: callbacks?.onCommentPosted ?? (() => {}),
      onApprovalCreated: callbacks?.onApprovalCreated ?? (() => {}),
      onApprovalResolved: callbacks?.onApprovalResolved ?? (() => {}),
      createDocument: callbacks?.createDocument
        ?? (() => { throw new Error("createDocument callback is not wired."); }),
      onAutoAssignTask: callbacks?.onAutoAssignTask ?? (() => null),
      onHumanMessage: callbacks?.onHumanMessage ?? (() => {}),
      injectRuntimeMessage: callbacks?.injectRuntimeMessage ?? (() => false),
      emitEvent: callbacks?.emitEvent ?? (() => {}),
      notify: callbacks?.notify ?? (() => {}),
    };
  }

  setBrowserActionHandler(handler: (actionId: string, companyId: string) => void) {
    this._onBrowserActionCb = handler;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this._server = createServer((req, res) => void this.handleRequest(req, res));
      this._server.listen(0, "127.0.0.1", () => {
        const srv = this._server;
        const addr = srv ? srv.address() : null;
        this._port = typeof addr === "object" && addr ? addr.port : 0;
        log.info(`[api] Agent API server listening on http://127.0.0.1:${this._port}`);
        resolve(this._port);
      });
      this._server.on("error", reject);
    });
  }

  stop() {
    this._server?.close();
    this._server = null;
  }

  addRoute(method: string, path: string, handler: RequestHandler) {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:(\w+)/g, (_match, name: string) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this._routes.push({ method, pattern: new RegExp(`^${patternStr}$`), paramNames, handler });
  }

  private authenticateRequest(
    req: IncomingMessage,
  ):
    | { ok: true; token: TokenPayload }
    | { ok: false; status: number; error: string } {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return { ok: false, status: 401, error: "Missing or invalid Authorization header" };
    }
    const token = validateAgentToken(authHeader.slice(7));
    if (!token) {
      return { ok: false, status: 401, error: "Invalid or expired token" };
    }
    const runHeader = req.headers["x-agent-company-run-id"];
    const claimedRunId = Array.isArray(runHeader) ? runHeader[0] : runHeader;
    if (typeof claimedRunId !== "string" || claimedRunId.trim() !== token.runId) {
      return { ok: false, status: 401, error: "Missing or mismatched X-Agent-Company-Run-Id header" };
    }
    const runState = this._db.runs.getRunAuthState(token.runId);
    if (!runState || runState.companyId !== token.companyId || runState.agentId !== token.agentId) {
      return { ok: false, status: 403, error: "Token references an unknown or mismatched run" };
    }
    if (!["queued", "running"].includes(runState.status)) {
      return { ok: false, status: 401, error: "Run token is no longer active" };
    }
    return { ok: true, token };
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    const authHeader = req.headers.authorization;
    const hasBearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ");
    const isPreflight = req.method === "OPTIONS";

    // Origin policy:
    //   - Bearer-token requests (agent CLIs, non-browser) are allowed without an Origin header.
    //     If an Origin IS present, it must be in the allowlist.
    //   - All other requests (browser-originating, including CORS preflight) MUST carry an
    //     Origin header and it MUST be in the allowlist.
    if (origin) {
      if (!this._allowedOrigins.has(origin)) {
        this.json(res, 403, { error: "Origin not allowed" });
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    } else if (!hasBearer || isPreflight) {
      this.json(res, 403, { error: "Origin header required" });
      return;
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Agent-Company-Run-Id");

    if (isPreflight) {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this._port}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    const auth = this.authenticateRequest(req);
    if (!auth.ok) {
      this.json(res, auth.status, { error: auth.error });
      return;
    }
    const token = auth.token;

    const retryAfter = this._rateLimiter.consume(`${token.companyId}:${token.agentId}`);
    if (retryAfter !== null) {
      res.setHeader("Retry-After", String(retryAfter));
      this.json(res, 429, { error: "Rate limit exceeded", retryAfterSeconds: retryAfter });
      return;
    }

    for (const route of this._routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name: string, i: number) => {
        params[name] = match[i + 1] ?? "";
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
    const invalid = refs.find((ref) => ref.id && !this._db.settings.belongsToCompany(ref.table, ref.id, companyId));
    if (!invalid) return false;
    this.json(res, 422, { error: `${invalid.label} does not belong to the current company` });
    return true;
  }

  // Accessors for route registrars
  get db(): AppDatabase { return this._db; }
  get callbacks(): ApiServerEventCallbacks { return this._callbacks; }
  get onDomainChanged(): () => void { return this._onDomainChangedCb; }
  get onWakeAgent(): (agentId: string, companyId: string, trigger: string) => string | null { return this._onWakeAgentCb; }
  get emitEvent(): (event: DesktopEvent) => void { return this._emitEventCb; }
  get onBrowserAction(): ((actionId: string, companyId: string) => void) | null { return this._onBrowserActionCb; }
  get port(): number { return this._port; }
}
