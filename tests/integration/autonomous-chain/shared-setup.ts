/**
 * Shared setup for the autonomous-chain integration test suite.
 *
 * The original 50KB autonomous-chain.spec.ts shared a module-level `db`,
 * `companyId`, and `workspaceId` across every describe block via top-level
 * `beforeEach`/`afterEach` hooks. This module exports `installSharedSetup`,
 * which each split spec file calls to wire equivalent hooks into its own
 * vitest context and hand back a live handle.
 *
 * The helpers preserve the exact behavior of the original file — tests are
 * physically moved, not rewritten.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach } from "vitest";
import { AppDatabase } from "../../../src/main/database";
import { buildSystemPrompt } from "../../../src/main/prompt-builder/index";
import type { AgentRecord, ApprovalRecord, TaskRecord } from "../../../src/shared/types";

export interface SharedContext {
  db: AppDatabase;
  companyId: string;
  workspaceId: string;
}

export interface SharedHandle {
  get db(): AppDatabase;
  set db(value: AppDatabase);
  get companyId(): string;
  get workspaceId(): string;
  createAgent(overrides?: Partial<Parameters<AppDatabase["saveAgent"]>[0]>): string;
  buildCtx(overrides?: Record<string, unknown>): Parameters<typeof buildSystemPrompt>[0];
  tempDirs: string[];
}

export function installSharedSetup(): SharedHandle {
  const state = {
    db: null as AppDatabase | null,
    companyId: "",
    workspaceId: "",
  };
  const tempDirs: string[] = [];

  async function createTempDir(prefix: string) {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  beforeEach(async () => {
    const profileDir = await createTempDir("agentcompany-chain-test-");
    state.db = new AppDatabase(profileDir);
    state.db.init();

    state.companyId = state.db.saveCompany({
      name: "Autonomous Test Corp",
      description: "Test company for autonomous chain",
      status: "active",
    });

    state.workspaceId = state.db.saveWorkspace({
      companyId: state.companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "https://example.com/repo.git",
      repoRef: "main",
      isPrimary: true,
    });
  });

  afterEach(async () => {
    state.db?.close();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function currentDb(): AppDatabase {
    if (!state.db) throw new Error("shared-setup: db accessed outside test hook");
    return state.db;
  }

  function createAgent(overrides: Partial<Parameters<AppDatabase["saveAgent"]>[0]> = {}): string {
    return currentDb().saveAgent({
      companyId: state.companyId,
      name: "TestAgent",
      role: "CEO",
      title: "Test",
      status: "idle",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId: state.workspaceId,
      model: null,
      capabilities: "Test capabilities",
      budgetMonthlyUsd: 200,
      ...overrides,
    });
  }

  function buildCtx(overrides: Record<string, unknown> = {}): Parameters<typeof buildSystemPrompt>[0] {
    const agent = currentDb().getAgent(overrides.agentId as string ?? createAgent());
    return {
      agent,
      apiUrl: "http://127.0.0.1:3000",
      apiKey: "test-key",
      runId: "test-run-id",
      task: null,
      companyName: "Autonomous Test Corp",
      goals: [],
      projects: [],
      directReports: overrides.directReports as AgentRecord[] ?? [],
      chainOfCommand: overrides.chainOfCommand as AgentRecord[] ?? [],
      assignedTasks: [],
      allAgents: [],
      pendingApprovals: overrides.pendingApprovals as ApprovalRecord[] ?? [],
      tasksAwaitingReview: overrides.tasksAwaitingReview as TaskRecord[] ?? [],
      wakeReason: overrides.wakeReason as string | null ?? null,
      allTasks: [],
      recentComments: [],
      companyDescription: "",
      socialAccounts: [],
      ...overrides,
    } as Parameters<typeof buildSystemPrompt>[0];
  }

  return {
    get db() { return currentDb(); },
    set db(value: AppDatabase) { state.db = value; },
    get companyId() { return state.companyId; },
    get workspaceId() { return state.workspaceId; },
    createAgent,
    buildCtx,
    tempDirs,
  };
}
