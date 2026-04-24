import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeBridge } from "../../src/main/agent-runtime";
import { AppDatabase } from "../../src/main/database";
import type { CredentialResolver } from "../../src/main/credentials";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createHarness() {
  const profileDir = await createTempDir("agentcompany-artifact-ack-");
  const workspacePath = await createTempDir("agentcompany-artifact-workspace-");
  const db = new AppDatabase(profileDir);
  db.init();
  const companyId = db.core.company.saveCompany({
    name: "Artifact Ack Co",
    description: "Durable artifact projection test",
    status: "active",
  });
  const workspaceId = db.core.workspaces.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: workspacePath,
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const agentId = db.core.agents.saveAgent({
    companyId,
    name: "Artifact Agent",
    role: "Engineer",
    title: "Engineer",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Writes files",
    budgetMonthlyUsd: 100,
  });
  const taskId = db.core.tasks.saveTask({
    companyId,
    title: "Produce artifact",
    description: "",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "medium",
    status: "in_progress",
  });
  const run = db.core.runs.createRun({
    companyId,
    taskId,
    agentId,
    workspaceId: null,
    connectorId: "openai-codex",
  });
  const bridge = new RuntimeBridge({
    db,
    emitEvent: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    credentialResolver: {
      resolve: vi.fn(async () => ({ apiKey: "test-api-key", extraEnv: {} })),
    } as unknown as CredentialResolver,
  });

  const prepare = await bridge.handleRpc({
    rpcId: "prepare",
    method: "prepareRun",
    runId: run.id,
    payload: {
      connectorId: "openai-codex",
      taskSessionId: "task-session-artifact-ack",
      agentId,
      companyId,
      taskId,
      modelId: "gpt-5.3-codex",
      workspaceId: null,
      workspacePath,
      workspaceMode: "none",
    },
  });
  expect(prepare.ok).toBe(true);

  return {
    db,
    bridge,
    companyId,
    workspacePath,
    agentId,
    taskId,
    runId: run.id,
  };
}

describe("artifact projection durable ack", () => {
  it("persists afterToolCall projection outcomes to the run event tail", async () => {
    const harness = await createHarness();
    try {
      await mkdir(join(harness.workspacePath, "reports"), { recursive: true });
      await writeFile(join(harness.workspacePath, "reports", "hook.md"), "hook artifact", "utf8");

      const response = await harness.bridge.handleRpc({
        rpcId: "after-tool",
        method: "afterToolCall",
        runId: harness.runId,
        payload: {
          toolName: "write",
          toolCallId: "tool-call-hook",
          args: { path: "reports/hook.md" },
          resultContent: [],
          resultDetails: null,
          isError: false,
        },
      });

      expect(response.ok).toBe(true);
      const event = harness.db.core.runs.listRunEvents(harness.runId, harness.companyId)[0];
      expect(event).toMatchObject({
        eventType: "artifact_projection",
        level: "info",
      });
      expect(event?.payload).toMatchObject({
        phase: "after_tool_call",
        toolName: "write",
        toolCallId: "tool-call-hook",
        workspaceMode: "none",
        counts: { inserted: 1, updated: 0, retired: 0, skipped: 0 },
      });
    } finally {
      harness.db.close();
    }
  });

  it("runs completion reconciliation before resource release for non-exclusive observation workspaces", async () => {
    const harness = await createHarness();
    try {
      await mkdir(join(harness.workspacePath, "reports"), { recursive: true });
      await writeFile(join(harness.workspacePath, "reports", "completion.md"), "completion artifact", "utf8");

      harness.bridge.releaseRunResources(harness.runId);

      expect(
        harness.db.projection.snapshot.listSnapshot().workProducts.some(
          (entry) => entry.externalId === "reports/completion.md",
        ),
      ).toBe(true);
      const events = harness.db.core.runs.listRunEvents(harness.runId, harness.companyId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: "artifact_projection",
        level: "info",
      });
      expect(events[0]?.payload).toMatchObject({
        phase: "completion_reconcile",
        workspaceMode: "none",
        counts: { inserted: 1, updated: 0, retired: 0, skipped: 0 },
      });
    } finally {
      harness.db.close();
    }
  });
});
