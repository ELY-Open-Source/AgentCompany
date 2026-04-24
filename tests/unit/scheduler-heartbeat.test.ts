import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  powerMonitor: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { AppDatabase } from "../../src/main/database";
import { createHeartbeat } from "../../src/main/orchestration/heartbeat";
import { createScheduler } from "../../src/main/orchestration/scheduler";
import type { OrchestrationDependencies } from "../../src/main/orchestration/types";

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createCompany(db: AppDatabase): string {
  return db.core.company.saveCompany({
    name: "Heartbeat Scheduler Co",
    description: "Scheduler gate contract test",
    status: "active",
  });
}

function createConnector(db: AppDatabase): void {
  db.core.connectors.saveConnector({
    id: "openai-codex",
    model: "gpt-5.4",
    envBindingText: "",
    notes: "Test connector",
  });
}

function createWorkspace(db: AppDatabase, companyId: string, localPath: string): string {
  return db.core.workspaces.saveWorkspace({
    companyId,
    name: "Primary",
    localPath,
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
}

function createAgent(db: AppDatabase, companyId: string, workspaceId: string): string {
  const agentId = db.core.agents.saveAgent({
    companyId,
    name: "Scheduler Agent",
    role: "CEO",
    title: "Chief Executive Officer",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: "gpt-5.4",
    capabilities: "Checks scheduler heartbeat gates",
    budgetMonthlyUsd: 100,
  });
  db.core.agents.setHeartbeat(agentId, true, 1);
  return agentId;
}

function createDeps(db: AppDatabase, overrides: Partial<OrchestrationDependencies> = {}): OrchestrationDependencies {
  return {
    db,
    logger: createLogger(),
    publishDomainChanged: vi.fn(),
    emitEvent: vi.fn(),
    notify: vi.fn(),
    createRunToken: () => "test-token",
    getApiPort: () => 3210,
    dispatchAutomation: vi.fn(),
    hasWorkerReady: () => true,
    enqueueWorkerRun: vi.fn(),
    isQuitting: () => false,
    listRuntimeSkillEntries: () => [],
    budgetService: {
      autoCloseExpiredIncidents: vi.fn(() => 0),
      evaluateBudgetGate: vi.fn(() => ({ allowed: true, blockedBy: [] })),
    } as never,
    checkpointEngine: { shouldPauseHeartbeat: () => false },
    ...overrides,
  };
}

describe("unified scheduler heartbeat cadence", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:00.000Z"));
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-scheduler-heartbeat-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("records worker readiness skips from the heartbeat wake decision", () => {
    const companyId = createCompany(db);
    createConnector(db);
    const workspaceId = createWorkspace(db, companyId, tempDir);
    const agentId = createAgent(db, companyId, workspaceId);
    const heartbeat = createHeartbeat(
      createDeps(db, { hasWorkerReady: () => false }),
      () => {
        throw new Error("resolveWorkspace should stay behind canRunAgent.");
      },
      () => null,
      vi.fn(),
      () => false,
    );

    expect(heartbeat.wakeAgentIfPossible(agentId, companyId, "timer")).toBeNull();

    const activity = db.projection.snapshot.listSnapshot({ companyId }).activity;
    const skip = activity.find((entry) => entry.action === "heartbeat.skipped");
    expect(skip?.entityId).toBe(agentId);
    expect(JSON.parse(skip?.detail ?? "{}")).toMatchObject({
      agentName: "Scheduler Agent",
      reason: "system_unavailable",
      detail: "worker_not_ready",
      trigger: "timer",
    });
    expect(db.core.agents.getRuntimeState(agentId)).not.toHaveProperty("heartbeatSkip");
  });

  it("keeps ordinary agent heartbeat cadence event-driven", () => {
    const companyId = createCompany(db);
    createConnector(db);
    const workspaceId = createWorkspace(db, companyId, tempDir);
    createAgent(db, companyId, workspaceId);
    const wakeAgentIfPossible = vi.fn();
    const scheduler = createScheduler(
      createDeps(db),
      () => false,
      wakeAgentIfPossible,
    );

    try {
      scheduler.startAllSchedulers();
      vi.advanceTimersByTime(60_000);
    } finally {
      scheduler.stopAllSchedulers();
    }

    expect(wakeAgentIfPossible).not.toHaveBeenCalled();
  });

  it("bootstraps the CEO through the wake pipeline", () => {
    const companyId = createCompany(db);
    createConnector(db);
    const workspaceId = createWorkspace(db, companyId, tempDir);
    const agentId = createAgent(db, companyId, workspaceId);
    db.core.entity.saveGoal({
      companyId,
      title: "Launch the company",
      description: "Create the first operating plan.",
      status: "active",
      ownerAgentId: agentId,
    });
    const wakeAgentIfPossible = vi.fn();
    const scheduler = createScheduler(
      createDeps(db, { hasWorkerReady: () => false }),
      () => false,
      wakeAgentIfPossible,
    );

    try {
      scheduler.startAllSchedulers();
      vi.advanceTimersByTime(60_000);
    } finally {
      scheduler.stopAllSchedulers();
    }

    expect(wakeAgentIfPossible).toHaveBeenCalledWith(agentId, companyId, "bootstrap");
  });

  it("keeps schedule cadence running while the worker is unavailable", () => {
    const companyId = createCompany(db);
    const dispatchAutomation = vi.fn();
    const scheduler = createScheduler(
      createDeps(db, {
        dispatchAutomation,
        hasWorkerReady: () => false,
      }),
      () => false,
      vi.fn(),
    );

    try {
      scheduler.startAllSchedulers();
      vi.advanceTimersByTime(60_000);
    } finally {
      scheduler.stopAllSchedulers();
    }

    expect(dispatchAutomation).toHaveBeenCalledWith("schedule", { companyId });
  });
});
