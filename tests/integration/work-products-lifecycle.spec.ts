import { mkdtemp, mkdir, rm, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import {
  reconcileWorkspaceArtifacts,
  type ArtifactProjectorRunContext,
} from "../../src/main/agent-runtime/artifact-projector";

/**
 * Regression coverage for the `work_products` retirement + visibility
 * contract. The projector stamps `status = 'archived'` when a file
 * disappears; every reader (renderer snapshot, task list, open target
 * resolver, deliverable signal) must honour that tombstone so the
 * DocumentCenter stops surfacing removed files and the review gate
 * stops counting deleted artifacts as produced output.
 */

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Harness {
  db: AppDatabase;
  companyId: string;
  workspaceId: string;
  workspacePath: string;
  agentId: string;
  taskId: string;
  runId: string;
}

async function createHarness(): Promise<Harness> {
  const profileDir = await createTempDir("agentcompany-workproducts-");
  const workspacePath = await createTempDir("agentcompany-workspace-");
  const db = new AppDatabase(profileDir);
  db.init();

  db.connectorsCrud.updateConnectorHealth({
    id: "openai-codex",
    status: "ready",
    authState: "authenticated",
    version: "test",
    lastError: null,
  });

  const companyId = db.company.saveCompany({
    name: "Work Products Co",
    description: "Tests archived visibility, bulk retirement, deliverable signal",
    status: "active",
  });
  const workspaceId = db.workspacesMod.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: workspacePath,
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const agentId = db.agents.saveAgent({
    companyId,
    name: "Artifact Engineer",
    role: "Engineer",
    title: "Artifact Engineer",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Writes files",
    budgetMonthlyUsd: 100,
  });
  const taskId = db.tasks.saveTask({
    companyId,
    title: "Produce artifact",
    description: "",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "medium",
    status: "in_progress",
  });
  const run = db.runs.createRun({
    companyId,
    taskId,
    agentId,
    workspaceId,
    connectorId: "openai-codex",
  });
  return {
    db,
    companyId,
    workspaceId,
    workspacePath,
    agentId,
    taskId,
    runId: run.id,
  };
}

function registerArtifact(harness: Harness, relativePath: string): string {
  return harness.db.documentsMod.createWorkProduct({
    companyId: harness.companyId,
    taskId: harness.taskId,
    workspaceId: harness.workspaceId,
    type: "file",
    provider: "filesystem",
    externalId: relativePath,
    title: relativePath,
    url: null,
    createdByRunId: harness.runId,
  });
}

describe("work_products archived visibility", () => {
  it("excludes archived rows from the renderer snapshot", async () => {
    const harness = await createHarness();
    try {
      const activeId = registerArtifact(harness, "docs/active.md");
      const archivedId = registerArtifact(harness, "docs/retired.md");
      harness.db.documentsMod.updateWorkProduct(archivedId, harness.companyId, {
        status: "archived",
        lastTouchedByRunId: harness.runId,
      });

      const snapshot = harness.db.snap.listSnapshot();
      const visibleIds = snapshot.workProducts.map((wp) => wp.id);
      expect(visibleIds).toContain(activeId);
      expect(visibleIds).not.toContain(archivedId);
    } finally {
      harness.db.close();
    }
  });

  it("excludes archived rows from the task-scoped listing", async () => {
    const harness = await createHarness();
    try {
      const activeId = registerArtifact(harness, "src/feature.ts");
      const archivedId = registerArtifact(harness, "src/removed.ts");
      harness.db.documentsMod.updateWorkProduct(archivedId, harness.companyId, {
        status: "archived",
        lastTouchedByRunId: harness.runId,
      });

      const rows = harness.db.documentsMod.listWorkProductsForTask(harness.taskId, harness.companyId);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(activeId);
      expect(ids).not.toContain(archivedId);
    } finally {
      harness.db.close();
    }
  });

  it("refuses to resolve an archived work product open target", async () => {
    const harness = await createHarness();
    try {
      const id = registerArtifact(harness, "notes/ghost.md");
      expect(
        harness.db.documentsMod.resolveWorkProductTarget(id, harness.companyId),
      ).not.toBeNull();

      harness.db.documentsMod.updateWorkProduct(id, harness.companyId, {
        status: "archived",
        lastTouchedByRunId: harness.runId,
      });

      expect(
        harness.db.documentsMod.resolveWorkProductTarget(id, harness.companyId),
      ).toMatchObject({ kind: "error", reason: "archived" });
    } finally {
      harness.db.close();
    }
  });
});

describe("work_products bulk retirement", () => {
  it("archives every deletion past the previous 50-path budget", async () => {
    const harness = await createHarness();
    try {
      const ids: string[] = [];
      const paths: string[] = [];
      for (let i = 0; i < 120; i += 1) {
        const rel = `build/asset-${i}.bin`;
        paths.push(rel);
        ids.push(registerArtifact(harness, rel));
      }

      const archived = harness.db.documentsMod.archiveWorkProductsByExternalPaths({
        companyId: harness.companyId,
        workspaceId: harness.workspaceId,
        provider: "filesystem",
        paths,
        lastTouchedByRunId: harness.runId,
      });

      expect(archived.length).toBe(120);
      const archivedIdSet = new Set(archived.map((r) => r.id));
      for (const id of ids) {
        expect(archivedIdSet.has(id)).toBe(true);
      }
      const visible = harness.db.snap.listSnapshot().workProducts;
      expect(visible.length).toBe(0);
    } finally {
      harness.db.close();
    }
  });

  it("skips rows that are already archived so repeated sweeps stay idempotent", async () => {
    const harness = await createHarness();
    try {
      const id = registerArtifact(harness, "tmp/scratch.log");
      harness.db.documentsMod.archiveWorkProductsByExternalPaths({
        companyId: harness.companyId,
        workspaceId: harness.workspaceId,
        provider: "filesystem",
        paths: ["tmp/scratch.log"],
        lastTouchedByRunId: harness.runId,
      });

      const second = harness.db.documentsMod.archiveWorkProductsByExternalPaths({
        companyId: harness.companyId,
        workspaceId: harness.workspaceId,
        provider: "filesystem",
        paths: ["tmp/scratch.log"],
        lastTouchedByRunId: harness.runId,
      });

      expect(second).toHaveLength(0);
      expect(
        harness.db.documentsMod.resolveWorkProductTarget(id, harness.companyId),
      ).toMatchObject({ kind: "error", reason: "archived" });
    } finally {
      harness.db.close();
    }
  });

  it("archives rows via the reconcile sweep when the baseline detects a missing file", async () => {
    const harness = await createHarness();
    try {
      await mkdir(join(harness.workspacePath, "reports"), { recursive: true });
      const relPath = "reports/summary.md";
      const absPath = join(harness.workspacePath, relPath);
      await writeFile(absPath, "initial content", "utf8");

      const workProductId = registerArtifact(harness, relPath);
      expect(
        harness.db.documentsMod.resolveWorkProductTarget(workProductId, harness.companyId),
      ).not.toBeNull();

      const baseline = {
        mtimeByRelPath: new Map<string, number>([[relPath, Date.now() / 1000]]),
        capturedAt: Date.now(),
        truncated: false,
      };

      await unlink(absPath);

      const ctx: ArtifactProjectorRunContext = {
        runId: harness.runId,
        agentId: harness.agentId,
        companyId: harness.companyId,
        taskId: harness.taskId,
        workspaceId: harness.workspaceId,
        workspacePath: harness.workspacePath,
        workspaceBaseline: baseline,
      };
      const outcomes = reconcileWorkspaceArtifacts(harness.db, ctx);
      const retired = outcomes.filter((o) => o.kind === "retired");
      expect(retired.map((o) => (o as { relativePath: string }).relativePath)).toContain(relPath);

      expect(
        harness.db.documentsMod.resolveWorkProductTarget(workProductId, harness.companyId),
      ).toMatchObject({ kind: "error", reason: "archived" });
    } finally {
      harness.db.close();
    }
  });
});

describe("work_products deliverable signal", () => {
  it("does not count an archived row as a produced deliverable", async () => {
    const harness = await createHarness();
    try {
      const id = registerArtifact(harness, "deliverables/final.md");
      const beforeArchive = harness.db.knowledgeMod.collectRunDeliverableSignals(
        harness.runId,
        harness.companyId,
        harness.taskId,
      );
      expect(beforeArchive.hasWorkProduct).toBe(true);

      harness.db.documentsMod.updateWorkProduct(id, harness.companyId, {
        status: "archived",
        lastTouchedByRunId: harness.runId,
      });

      const afterArchive = harness.db.knowledgeMod.collectRunDeliverableSignals(
        harness.runId,
        harness.companyId,
        harness.taskId,
      );
      expect(afterArchive.hasWorkProduct).toBe(false);
    } finally {
      harness.db.close();
    }
  });
});
