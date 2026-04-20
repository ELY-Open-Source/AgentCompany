import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentToken, initializeAgentTokenSigningKey } from "../../src/main/agent-auth";
import { createApiServer } from "../../src/main/api-server";
import { AppDatabase } from "../../src/main/database";
import { processRunCompletion } from "../../src/main/automation/automation-run-completion";
import { createDocumentWithLifecycle } from "../../src/main/document-lifecycle";

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
  const profileDir = await createTempDir("agentcompany-doc-provenance-");
  initializeAgentTokenSigningKey(profileDir);
  const db = new AppDatabase(profileDir);
  db.init();

  db.updateConnectorHealth({
    id: "openai-codex",
    status: "ready",
    authState: "authenticated",
    version: "test",
    lastError: null,
  });

  const companyId = db.saveCompany({
    name: "Document Provenance Co",
    description: "Tests document revision provenance through run completion",
    status: "active",
  });
  const workspaceId = db.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: profileDir,
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const agentId = db.agents.saveAgent({
    companyId,
    name: "Research Lead",
    role: "Researcher",
    title: "Research Lead",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Research and synthesis",
    budgetMonthlyUsd: 180,
  });
  const taskId = db.tasks.saveTask({
    companyId,
    title: "Refresh the market report",
    description: "Update the report with new findings and submit it for review.",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "high",
    status: "in_progress",
  });
  db.tasks.setTaskType(taskId, "research");

  const existingDocumentId = db.saveDocument({
    companyId,
    type: "knowledge_article",
    title: "Market report",
    content: "Initial report body",
    authorAgentId: agentId,
    projectId: null,
    goalId: null,
    status: "draft",
  });

  const run = db.createRun({
    companyId,
    taskId,
    agentId,
    workspaceId,
    connectorId: "openai-codex",
  });
  const token = createAgentToken(agentId, companyId, run.id);
  const silentLogger = { warn: () => {}, error: () => {} };
  const noopLifecycleProcessor = { drainForDocument: () => {} };
  const server = createApiServer(db, () => {}, () => null, {
    createDocument: (input) =>
      createDocumentWithLifecycle(
        {
          db,
          threadIntegration: {
            onDocumentCreated: () => {},
          } as never,
          checkpointEngine: { onDocumentDrafted: () => null } as never,
          lifecycleProcessor: noopLifecycleProcessor,
          publishDomainChanged: () => {},
          logger: silentLogger,
        },
        input,
      ),
  });
  const port = await server.start();

  return {
    db,
    server,
    run,
    companyId,
    taskId,
    existingDocumentId,
    baseUrl: `http://127.0.0.1:${port}`,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Agent-Company-Run-Id": run.id,
      "Content-Type": "application/json; charset=utf-8",
    },
  };
}

describe("document run provenance", () => {
  it("keeps sourceRunId on revised documents so run completion still counts them as deliverables", async () => {
    const harness = await createHarness();
    try {
      const patchResponse = await fetch(
        `${harness.baseUrl}/api/companies/${harness.companyId}/documents/${harness.existingDocumentId}`,
        {
          method: "PATCH",
          headers: harness.headers,
          body: JSON.stringify({
            content: "Updated report with new evidence and recommendations.",
            changeSummary: "Add latest market evidence",
          }),
        },
      );

      expect(patchResponse.status).toBe(200);
      const updatedDocument = harness.db.queryAll<{ sourceRunId: string | null }>(
        "select source_run_id as sourceRunId from documents where id = ? limit 1",
        harness.existingDocumentId,
      )[0];
      expect(updatedDocument?.sourceRunId).toBe(harness.run.id);

      const persistedRun = harness.db.listSnapshot().runs.find((entry) => entry.id === harness.run.id);
      if (!persistedRun) {
        throw new Error("Expected persisted run record for provenance test.");
      }

      processRunCompletion({
        db: harness.db,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        publishDomainChanged: () => {},
        notify: vi.fn(),
        wakeAgentIfPossible: vi.fn().mockReturnValue(null),
      }, {
        dispatchAutomation: vi.fn(),
        handleTaskStatusChange: vi.fn(),
      }, persistedRun, {
        status: "succeeded",
        summary: "Updated the market report",
        errorMessage: null,
      }, () => false);

      // ai_ceo + top-level CEO without `reviewDeliverables` advances
      // straight to `done` — there is no reviewer in that configuration
      // so the prior `in_review` state was a dead letter.
      const task = harness.db.entityCrud.getTask(harness.taskId);
      expect(task.status).toBe("done");
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });

  it("increments document version across multiple edits and rejects invalid reviewers without partial mutation", async () => {
    const harness = await createHarness();
    try {
      const firstPatch = await fetch(
        `${harness.baseUrl}/api/companies/${harness.companyId}/documents/${harness.existingDocumentId}`,
        {
          method: "PATCH",
          headers: harness.headers,
          body: JSON.stringify({
            content: "First revision of the report",
            changeSummary: "Initial revision",
          }),
        },
      );
      expect(firstPatch.status).toBe(200);

      const revisionState = harness.db.queryAll<{ version: number; latestRevisionId: string | null }>(
        "select version, latest_revision_id as latestRevisionId from documents where id = ? limit 1",
        harness.existingDocumentId,
      )[0];
      expect(revisionState?.version).toBe(2);
      expect(revisionState?.latestRevisionId).not.toBeNull();

      const invalidReviewerPatch = await fetch(
        `${harness.baseUrl}/api/companies/${harness.companyId}/documents/${harness.existingDocumentId}`,
        {
          method: "PATCH",
          headers: harness.headers,
          body: JSON.stringify({
            reviewerAgentId: "00000000-0000-0000-0000-000000000000",
            content: "This write should be rejected before any mutation occurs",
            changeSummary: "Invalid reviewer should block this patch",
          }),
        },
      );
      expect(invalidReviewerPatch.status).toBe(400);

      const rejectedState = harness.db.queryAll<{ version: number; content: string; revisionCount: number }>(
        `select d.version as version, d.content as content,
                (select count(*) from document_revisions where document_id = d.id and company_id = d.company_id) as revisionCount
           from documents d where d.id = ? limit 1`,
        harness.existingDocumentId,
      )[0];
      expect(rejectedState?.version).toBe(2);
      expect(rejectedState?.content).toBe("First revision of the report");
      expect(rejectedState?.revisionCount).toBe(1);

      const secondPatch = await fetch(
        `${harness.baseUrl}/api/companies/${harness.companyId}/documents/${harness.existingDocumentId}`,
        {
          method: "PATCH",
          headers: harness.headers,
          body: JSON.stringify({
            content: "Second revision of the report",
            changeSummary: "Follow-up revision",
          }),
        },
      );
      expect(secondPatch.status).toBe(200);

      const finalState = harness.db.queryAll<{ version: number; revisionCount: number }>(
        `select d.version as version,
                (select count(*) from document_revisions where document_id = d.id and company_id = d.company_id) as revisionCount
           from documents d where d.id = ? limit 1`,
        harness.existingDocumentId,
      )[0];
      expect(finalState?.version).toBe(3);
      expect(finalState?.revisionCount).toBe(2);
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });

  it("does not stamp sourceRunId for metadata-only document patches", async () => {
    const harness = await createHarness();
    try {
      const metadataPatch = await fetch(
        `${harness.baseUrl}/api/companies/${harness.companyId}/documents/${harness.existingDocumentId}`,
        {
          method: "PATCH",
          headers: harness.headers,
          body: JSON.stringify({
            title: "Renamed market report",
          }),
        },
      );

      expect(metadataPatch.status).toBe(200);
      const updatedDocument = harness.db.queryAll<{ sourceRunId: string | null; title: string }>(
        "select source_run_id as sourceRunId, title from documents where id = ? limit 1",
        harness.existingDocumentId,
      )[0];
      expect(updatedDocument?.sourceRunId).toBeNull();
      expect(updatedDocument?.title).toBe("Renamed market report");
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });

  it("creates deliverable review approvals that stay linked to the originating task", async () => {
    const harness = await createHarness();
    try {
      harness.db.saveCompany({
        id: harness.companyId,
        name: "Document Provenance Co",
        description: "Tests document review task linkage",
        status: "active",
        reviewDeliverables: true,
      });

      const createResponse = await fetch(
        `${harness.baseUrl}/api/companies/${harness.companyId}/documents`,
        {
          method: "POST",
          headers: harness.headers,
          body: JSON.stringify({
            type: "prd",
            title: "Run-linked PRD",
            content: "Initial draft that should trigger deliverable review.",
            status: "draft",
          }),
        },
      );

      expect(createResponse.status).toBe(201);
      const approvals = harness.db.listSnapshot().approvals.filter((approval) => approval.type === "deliverable_review");
      expect(approvals).toHaveLength(1);
      expect(approvals[0]?.relatedTaskId).toBe(harness.taskId);
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });
});
