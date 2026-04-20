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
import {
  resolveWorkspaceWithLockMode,
  WorkspaceConfigurationError,
} from "../../src/main/orchestration/resolve-workspace";

/**
 * Workspace lock policy (v52+).
 *
 * `lockMode='exclusive'` is opt-in — either the task carries an
 * explicit workspaceId, or the task's requiresFilesystem column is
 * true, or the resolving agent is in a coding role. Every other
 * case returns `lockMode='none'` and `workspace=null`, so four
 * pure-cognitive agents run fully in parallel without queueing on
 * a single workspace lock. The previous `company_fallback` step
 * (which returned any workspace in the company as the lock target)
 * has been removed and now throws `WorkspaceConfigurationError`.
 */

function seedCompany(db: AppDatabase) {
  const companyId = db.company.saveCompany({
    name: "Parallel Co",
    description: "Regression fixture",
    status: "active",
  });
  db.connectorsCrud.saveConnector({
    id: "openai-codex",
    model: "gpt-5",
    envBindingText: "",
    notes: "fixture",
  });
  const workspaceId = db.workspacesMod.saveWorkspace({
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

  it("task.workspaceId set → exclusive on that workspace", () => {
    const { companyId, workspaceId } = seedCompany(db);
    const result = resolveWorkspaceWithLockMode(
      db,
      { workspaceId, projectId: null },
      { workspaceId: null, role: "CMO", department: "marketing" },
      companyId,
    );
    expect(result.source).toBe("task");
    expect(result.lockMode).toBe("exclusive");
    expect(result.workspace?.id).toBe(workspaceId);
  });

  it("coding-role agent + agent workspace → exclusive on agent workspace", () => {
    const { companyId, workspaceId } = seedCompany(db);
    const result = resolveWorkspaceWithLockMode(
      db,
      null,
      { workspaceId, role: "CTO", department: "engineering" },
      companyId,
    );
    expect(result.source).toBe("agent");
    expect(result.lockMode).toBe("exclusive");
    expect(result.workspace?.id).toBe(workspaceId);
  });

  it("coding-role agent + project primary workspace → exclusive on project workspace", () => {
    const { companyId } = seedCompany(db);
    const projectId = db.entityCrud.saveProject({
      companyId,
      name: "Platform",
      description: "",
      status: "active",
    });
    const projectWsId = db.workspacesMod.saveWorkspace({
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
      { workspaceId: null, projectId, requiresFilesystem: true },
      { workspaceId: null, role: "CEO", department: "executive" },
      companyId,
    );
    expect(result.source).toBe("project");
    expect(result.lockMode).toBe("exclusive");
    expect(result.workspace?.id).toBe(projectWsId);
  });

  it("task.requiresFilesystem signals exclusive even for non-coding role", () => {
    const { companyId, workspaceId } = seedCompany(db);
    const result = resolveWorkspaceWithLockMode(
      db,
      { workspaceId: null, projectId: null, requiresFilesystem: true },
      { workspaceId, role: "COO", department: "operations" },
      companyId,
    );
    expect(result.lockMode).toBe("exclusive");
    expect(result.source).toBe("agent");
  });

  it("pure cognitive task (no coding role, no requiresFilesystem) → none", () => {
    const { companyId } = seedCompany(db);
    const result = resolveWorkspaceWithLockMode(
      db,
      { workspaceId: null, projectId: null },
      { workspaceId: null, role: "CMO", department: "marketing" },
      companyId,
    );
    expect(result.source).toBe("none");
    expect(result.lockMode).toBe("none");
    expect(result.workspace).toBeNull();
  });

  it("task.workspaceId wins over agent.workspaceId even when both are set", () => {
    const { companyId, workspaceId: agentWsId } = seedCompany(db);
    const taskWsId = db.workspacesMod.saveWorkspace({
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
      { workspaceId: agentWsId, role: "CTO", department: "engineering" },
      companyId,
    );
    expect(result.source).toBe("task");
    expect(result.lockMode).toBe("exclusive");
    expect(result.workspace?.id).toBe(taskWsId);
  });

  it("filesystem-requiring task with no resolvable workspace → throws WorkspaceConfigurationError", () => {
    const companyId = db.company.saveCompany({
      name: "Empty Co",
      description: "",
      status: "active",
    });
    expect(() =>
      resolveWorkspaceWithLockMode(
        db,
        { workspaceId: null, projectId: null, requiresFilesystem: true },
        { workspaceId: null, role: "CTO", department: "engineering" },
        companyId,
      ),
    ).toThrow(WorkspaceConfigurationError);
  });

  it("non-coding role with no workspace bindings → none (never throws, never falls back to shared lock)", () => {
    const companyId = db.company.saveCompany({
      name: "Empty Co",
      description: "",
      status: "active",
    });
    const result = resolveWorkspaceWithLockMode(
      db,
      null,
      { workspaceId: null, role: "CFO", department: "finance" },
      companyId,
    );
    expect(result.lockMode).toBe("none");
    expect(result.workspace).toBeNull();
  });

  it("four non-coding agents resolving in parallel all get lockMode=none (no shared lock collision)", () => {
    const { companyId } = seedCompany(db);
    const roles = [
      { role: "CEO", department: "executive" as const },
      { role: "CMO", department: "marketing" as const },
      { role: "CPO", department: "product" as const },
      { role: "COO", department: "operations" as const },
    ];
    const modes = roles.map((r) =>
      resolveWorkspaceWithLockMode(db, null, { workspaceId: null, ...r }, companyId),
    );
    for (const m of modes) {
      expect(m.lockMode).toBe("none");
      expect(m.workspace).toBeNull();
    }
  });
});
