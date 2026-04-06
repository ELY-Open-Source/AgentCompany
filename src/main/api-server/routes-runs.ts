import type { TokenPayload } from "../agent-auth";
import { requireParam, type AgentApiServer } from "./server-core";

const DEFAULT_EVENT_LIMIT = 500;
const MAX_EVENT_LIMIT = 5_000;
const EVENT_POLL_INTERVAL_MS = 500;
const SSE_HEARTBEAT_MS = 15_000;

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function resolveAuthorizedRun(server: AgentApiServer, token: TokenPayload, runId: string) {
  const runState = server.db.getRunAuthState(runId);
  if (!runState || runState.companyId !== token.companyId || runState.agentId !== token.agentId) {
    return null;
  }
  return runState;
}

function writeSse(res: Parameters<AgentApiServer["json"]>[0], event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerRunRoutes(server: AgentApiServer) {
  server.addRoute("GET", "/api/runs/:runId/events", (req, res, params, token) => {
    const runId = requireParam(params, "runId");
    const runState = resolveAuthorizedRun(server, token, runId);
    if (!runState) {
      server.json(res, 404, { error: "Run not found for the current agent token" });
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${server.port}`);
    const offset = parsePositiveInt(url.searchParams.get("offset"), 0);
    const limit = Math.min(parsePositiveInt(url.searchParams.get("limit"), DEFAULT_EVENT_LIMIT), MAX_EVENT_LIMIT);
    const events = server.db.listRunEvents(runId, token.companyId, { offset, limit });
    server.json(res, 200, { events, nextOffset: offset + events.length });
  });

  server.addRoute("GET", "/api/runs/:runId/events/stream", (req, res, params, token) => {
    const runId = requireParam(params, "runId");
    const runState = resolveAuthorizedRun(server, token, runId);
    if (!runState) {
      server.json(res, 404, { error: "Run not found for the current agent token" });
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${server.port}`);
    let cursor = parsePositiveInt(url.searchParams.get("after"), 0);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    writeSse(res, "connected", { runId, after: cursor });

    const flushPendingEvents = () => {
      const events = server.db
        .listRunEvents(runId, token.companyId, { offset: 0, limit: MAX_EVENT_LIMIT })
        .filter((event) => event.seq > cursor);
      for (const event of events) {
        writeSse(res, "run-event", event);
        cursor = event.seq;
      }
    };

    flushPendingEvents();
    const pollTimer = setInterval(flushPendingEvents, EVENT_POLL_INTERVAL_MS);
    const heartbeatTimer = setInterval(() => {
      res.write(":keepalive\n\n");
    }, SSE_HEARTBEAT_MS);

    const cleanup = () => {
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
    };

    req.on("close", cleanup);
    req.on("error", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  });
}
