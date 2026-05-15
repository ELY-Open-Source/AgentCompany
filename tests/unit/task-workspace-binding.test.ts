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
import { resolveTaskWorkspaceBinding } from "../../src/main/task-workspace-binding";

describe("resolveTaskWorkspaceBinding", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-task-workspace-binding-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("binds filesystem tasks to the creator agent workspace", () => {
    const { companyId, workspaceId, agentId } = seedCompany(db);
    const result = resolveTaskWorkspaceBinding(db, {
      companyId,
      requiresFilesystem: true,
      creatorAgentId: agentId,
    });

    expect(result).toEqual({ ok: true, workspaceId, source: "creator" });
  });

  it("binds filesystem tasks to the only company workspace", () => {
    const { companyId, workspaceId } = seedCompany(db, { agentWorkspace: false });
    const result = resolveTaskWorkspaceBinding(db, {
      companyId,
      requiresFilesystem: true,
    });

    expect(result).toEqual({ ok: true, workspaceId, source: "single_company" });
  });

  it("rejects filesystem tasks when the workspace is ambiguous", () => {
    const { companyId } = seedCompany(db, { agentWorkspace: false });
    db.core.workspaces.saveWorkspace({
      companyId,
      name: "Second",
      localPath: "/tmp/second",
      repoUrl: "",
      repoRef: "",
      isPrimary: false,
    });

    const result = resolveTaskWorkspaceBinding(db, {
      companyId,
      requiresFilesystem: true,
    });

    expect(result.ok).toBe(false);
  });
});

function seedCompany(db: AppDatabase, options: { agentWorkspace?: boolean } = {}) {
  const companyId = db.core.company.saveCompany({
    name: "Workspace Binding Co",
    description: "",
    status: "active",
  });
  db.core.connectors.saveConnector({
    id: "openai-codex",
    model: "gpt-5",
    envBindingText: "",
    notes: "",
  });
  const workspaceId = db.core.workspaces.saveWorkspace({
    companyId,
    name: "Default",
    localPath: "/tmp/default",
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const agentId = db.core.agents.saveAgent({
    companyId,
    name: "CEO",
    role: "CEO",
    title: "CEO",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId: options.agentWorkspace === false ? null : workspaceId,
    model: null,
    capabilities: "Leadership",
    budgetMonthlyUsd: 100,
  });
  return { companyId, workspaceId, agentId };
}
