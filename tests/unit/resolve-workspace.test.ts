import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { AppDatabase } from "../../src/main/database";
import { resolveWorkspaceWithLockMode } from "../../src/main/orchestration/resolve-workspace";

/**
 * Regression tests for the current workspace lock policy: every
 * resolved workspace is held exclusively for the duration of the run.
 * Pi's coding tools always include bash/write/edit, so there is no
 * read-only category where concurrent runs are safe; teammates
 * sharing one repo queue through the wakeup table instead of racing
 * the filesystem.
 *
 * See `resolve-workspace.ts` for the full rationale.
 */

function seedCompany(db: AppDatabase) {
  const companyId = db.saveCompany({
    name: "Parallel Co",
    description: "Regression fixture",
    status: "active",
  });
  db.saveConnector({
    id: "openai-codex",
    model: "gpt-5",
    envBindingText: "",
    notes: "fixture",
  });
  const workspaceId = db.saveWorkspace({
    companyId,
    name: "Default",
    localPath: "/tmp/fixture",
    repoUrl: "https://github.com/example/fixture",
    repoRef: "main",
    isPrimary: true,
  });
  return { companyId, workspaceId };
}

describe("resolveWorkspaceWithLockMode", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "resolve-workspace-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("task-bound workspace → exclusive (explicit opt-in)", () => {
    const { companyId, workspaceId } = seedCompany(db);
    const result = resolveWorkspaceWithLockMode(
      db,
      { workspaceId, projectId: null },
      { workspaceId: null },
      companyId,
    );
    expect(result.source).toBe("task");
    expect(result.lockMode).toBe("exclusive");
    expect(result.workspace?.id).toBe(workspaceId);
  });

  it("agent-bound workspace → exclusive (single writer per repo)", () => {
    const { companyId, workspaceId } = seedCompany(db);
    const result = resolveWorkspaceWithLockMode(
      db,
      null,
      { workspaceId },
      companyId,
    );
    expect(result.source).toBe("agent");
    expect(result.lockMode).toBe("exclusive");
  });

  it("project-bound workspace → exclusive (single writer per repo)", () => {
    const { companyId } = seedCompany(db);
    const projectId = db.saveProject({
      companyId,
      name: "Platform",
      description: "",
      status: "active",
    });
    db.saveWorkspace({
      companyId,
      name: "Project repo",
      localPath: "/tmp/project-ws",
      repoUrl: "https://github.com/example/project",
      repoRef: "main",
      projectId,
      isPrimary: true,
    });

    const result = resolveWorkspaceWithLockMode(
      db,
      { workspaceId: null, projectId },
      { workspaceId: null },
      companyId,
    );
    expect(result.source).toBe("project");
    expect(result.lockMode).toBe("exclusive");
  });

  it("company-fallback → exclusive (single writer per repo)", () => {
    const { companyId } = seedCompany(db);
    const result = resolveWorkspaceWithLockMode(
      db,
      null,
      { workspaceId: null },
      companyId,
    );
    expect(result.source).toBe("company_fallback");
    expect(result.lockMode).toBe("exclusive");
  });

  it("task workspace wins over agent workspace even when both are set", () => {
    const { companyId, workspaceId: agentWsId } = seedCompany(db);
    const taskWsId = db.saveWorkspace({
      companyId,
      name: "Task-only",
      localPath: "/tmp/task-ws",
      repoUrl: "https://github.com/example/task",
      repoRef: "main",
      isPrimary: false,
    });
    const result = resolveWorkspaceWithLockMode(
      db,
      { workspaceId: taskWsId, projectId: null },
      { workspaceId: agentWsId },
      companyId,
    );
    expect(result.source).toBe("task");
    expect(result.lockMode).toBe("exclusive");
    expect(result.workspace?.id).toBe(taskWsId);
  });

  it("no workspace at all → none", () => {
    const companyId = db.saveCompany({
      name: "Empty Co",
      description: "",
      status: "active",
    });
    const result = resolveWorkspaceWithLockMode(
      db,
      null,
      { workspaceId: null },
      companyId,
    );
    expect(result.source).toBe("none");
    expect(result.lockMode).toBe("none");
    expect(result.workspace).toBeNull();
  });
});
