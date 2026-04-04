import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentToken, initializeAgentTokenSigningKey } from "../../src/main/agent-auth";
import { createApiServer } from "../../src/main/api-server";
import { AppDatabase } from "../../src/main/database";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createHarness() {
  const profileDir = await createTempDir("agentcompany-api-events-");
  initializeAgentTokenSigningKey(profileDir);
  const db = new AppDatabase(profileDir);
  db.init();

  const companyId = db.saveCompany({ name: "Orbit Foundry", description: "API test", status: "active" });
  const workspaceId = db.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: profileDir,
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const agentId = db.saveAgent({
    companyId,
    name: "Helios",
    role: "CEO",
    title: "Lead agent",
    status: "active",
    reportsTo: null,
    connectorId: "codex_local",
    workspaceId,
    model: null,
    capabilities: "Operate the company",
    budgetMonthlyUsd: 100,
  });
  const taskId = db.saveTask({
    companyId,
    title: "Ship the API",
    description: "Capture structured run events.",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "high",
    status: "todo",
  });
  const run = db.createRun({ companyId, taskId, agentId, workspaceId, connectorId: "codex_local" });
  const token = createAgentToken(agentId, companyId, run.id);
  const server = createApiServer(db, () => {}, () => null);
  const port = await server.start();

  return {
    db,
    server,
    runId: run.id,
    companyId,
    agentId,
    baseUrl: `http://127.0.0.1:${port}`,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Agent-Company-Run-Id": run.id,
    },
  };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, matcher: (text: string) => boolean, timeoutMs = 4_000) {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (matcher(text)) {
      return text;
    }
  }

  throw new Error(`Timed out waiting for stream match. Received: ${text}`);
}

describe("run event API", () => {
  it("returns persisted run events for the active run token", async () => {
    const harness = await createHarness();
    try {
      harness.db.appendRunEvent({
        companyId: harness.companyId,
        runId: harness.runId,
        agentId: harness.agentId,
        eventType: "run_status",
        level: "info",
        message: "Run started",
        payload: { status: "running" },
      });

      const response = await fetch(`${harness.baseUrl}/api/runs/${harness.runId}/events?offset=0&limit=10`, {
        headers: harness.headers,
      });

      expect(response.status).toBe(200);
      const body = await response.json() as {
        events: Array<{ eventType: string; message: string | null; payload: Record<string, unknown> | null }>;
        nextOffset: number;
      };
      expect(body.events).toHaveLength(1);
      expect(body.events[0]?.eventType).toBe("run_status");
      expect(body.events[0]?.message).toBe("Run started");
      expect(body.events[0]?.payload).toMatchObject({ status: "running" });
      expect(body.nextOffset).toBe(1);
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });

  it("streams new run events over SSE for the active run token", async () => {
    const harness = await createHarness();
    const controller = new AbortController();
    try {
      const response = await fetch(`${harness.baseUrl}/api/runs/${harness.runId}/events/stream`, {
        headers: harness.headers,
        signal: controller.signal,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      setTimeout(() => {
        harness.db.appendRunEvent({
          companyId: harness.companyId,
          runId: harness.runId,
          agentId: harness.agentId,
          eventType: "run_log",
          stream: "stdout",
          message: "hello from sse",
        });
      }, 100);

      const text = await readUntil(reader!, (chunk) => chunk.includes("event: run-event") && chunk.includes("hello from sse"));
      expect(text).toContain("event: connected");
      expect(text).toContain("\"eventType\":\"run_log\"");
      expect(text).toContain("\"message\":\"hello from sse\"");
    } finally {
      controller.abort();
      harness.server.stop();
      harness.db.close();
    }
  });
});
