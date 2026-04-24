import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentToken, initializeAgentTokenSigningKey } from "../../src/main/agent-auth";
import { createApiServer } from "../../src/main/api-server";
import { AppDatabase } from "../../src/main/database";
import { createTestApiServerCallbacks } from "../support/api-server-callbacks";

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
  const profileDir = await createTempDir("agentcompany-work-product-url-");
  initializeAgentTokenSigningKey(profileDir);
  const db = new AppDatabase(profileDir);
  db.init();
  db.core.connectors.updateConnectorHealth({
    id: "openai-codex",
    status: "ready",
    authState: "authenticated",
    version: "test",
    lastError: null,
  });

  const companyId = db.core.company.saveCompany({
    name: "URL Policy Co",
    description: "Tests work product URL trust policy",
    status: "active",
  });
  const workspaceId = db.core.workspaces.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: profileDir,
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const agentId = db.core.agents.saveAgent({
    companyId,
    name: "Reporter",
    role: "Researcher",
    title: "Reporter",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Writes reports",
    budgetMonthlyUsd: 100,
  });
  const taskId = db.core.tasks.saveTask({
    companyId,
    title: "Publish external report",
    description: "Attach a report link.",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "medium",
    status: "in_progress",
  });
  const run = db.core.runs.createRun({
    companyId,
    taskId,
    agentId,
    workspaceId,
    connectorId: "openai-codex",
  });
  const token = createAgentToken(agentId, companyId, run.id);
  const server = createApiServer(db, createTestApiServerCallbacks());
  const port = await server.start();

  return {
    db,
    server,
    companyId,
    taskId,
    baseUrl: `http://127.0.0.1:${port}`,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Agent-Company-Run-Id": run.id,
      "Content-Type": "application/json; charset=utf-8",
    },
  };
}

describe("work product URL API policy", () => {
  it("rejects blank URLs during work product creation", async () => {
    const harness = await createHarness();
    try {
      const response = await fetch(`${harness.baseUrl}/api/issues/${harness.taskId}/work-products`, {
        method: "POST",
        headers: harness.headers,
        body: JSON.stringify({
          type: "link",
          provider: "external",
          title: "Blank URL",
          url: "   ",
        }),
      });

      expect(response.status).toBe(400);
      expect(harness.db.queryAll("select id from work_products")).toHaveLength(0);
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });

  it("rejects custom schemes during work product creation", async () => {
    const harness = await createHarness();
    try {
      const response = await fetch(`${harness.baseUrl}/api/issues/${harness.taskId}/work-products`, {
        method: "POST",
        headers: harness.headers,
        body: JSON.stringify({
          type: "link",
          provider: "external",
          title: "Local scheme",
          url: "vscode://file/etc/passwd",
        }),
      });

      expect(response.status).toBe(400);
      expect(harness.db.queryAll("select id from work_products")).toHaveLength(0);
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });

  it("rejects credential-bearing URLs during work product creation", async () => {
    const harness = await createHarness();
    try {
      const response = await fetch(`${harness.baseUrl}/api/issues/${harness.taskId}/work-products`, {
        method: "POST",
        headers: harness.headers,
        body: JSON.stringify({
          type: "link",
          provider: "external",
          title: "Credential URL",
          url: "https://user:pass@example.com/reports/q1",
        }),
      });

      expect(response.status).toBe(400);
      expect(harness.db.queryAll("select id from work_products")).toHaveLength(0);
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });

  it("stores http links for later confirmation during open", async () => {
    const harness = await createHarness();
    try {
      const response = await fetch(`${harness.baseUrl}/api/issues/${harness.taskId}/work-products`, {
        method: "POST",
        headers: harness.headers,
        body: JSON.stringify({
          type: "link",
          provider: "external",
          title: "External report",
          url: " https://example.com/reports/q1 ",
        }),
      });

      expect(response.status).toBe(201);
      const row = harness.db.queryAll<{ url: string }>("select url from work_products limit 1")[0];
      expect(row?.url).toBe("https://example.com/reports/q1");
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });

  it("rejects custom schemes during work product updates", async () => {
    const harness = await createHarness();
    try {
      const id = harness.db.core.documents.createWorkProduct({
        companyId: harness.companyId,
        taskId: harness.taskId,
        type: "link",
        provider: "external",
        title: "External report",
        url: "https://example.com/reports/q1",
      });

      const response = await fetch(`${harness.baseUrl}/api/work-products/${id}`, {
        method: "PATCH",
        headers: harness.headers,
        body: JSON.stringify({ url: "file:///etc/passwd" }),
      });

      expect(response.status).toBe(400);
      const row = harness.db.queryAll<{ url: string }>("select url from work_products where id = ? limit 1", id)[0];
      expect(row?.url).toBe("https://example.com/reports/q1");
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });
});
